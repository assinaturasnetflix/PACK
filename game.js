const { User, Game, Transaction, LobbyGame } = require('models.js');
const mongoose = require('mongoose');

const initialBoardArray = [
    'b', 'b', 'b', 'b',
    'b', 'b', 'b', 'b',
    'b', 'b', 'b', 'b',
    ' ', ' ', ' ', ' ',
    ' ', ' ', ' ', ' ',
    'w', 'w', 'w', 'w',
    'w', 'w', 'w', 'w',
    'w', 'w', 'w', 'w'
];

const pieceColors = {
    white: 'w',
    black: 'b'
};

const gameLogic = {
    parseBoard(boardState) {
        return boardState.split(',');
    },

    stringifyBoard(boardArray) {
        return boardArray.join(',');
    },

    getPieceColor(piece) {
        return piece.toLowerCase() === 'w' ? 'white' : 'black';
    },

    isKing(piece) {
        return piece === 'W' || piece === 'B';
    },

    getOpponentColor(color) {
        return color === 'white' ? 'black' : 'white';
    },

    isValidPosition(index) {
        return index >= 0 && index < 32;
    },

    getPosition(row, col) {
        if (row < 0 || row > 7 || col < 0 || col > 7) return -1;
        return Math.floor(row / 2) * 4 + Math.floor(col / 2) + (row % 2 === 0 ? 0 : 4);
    },

    findAllPossibleMoves(board, playerColor) {
        const moves = [];
        const captureMoves = [];

        for (let i = 0; i < 32; i++) {
            const piece = board[i];
            if (piece !== ' ' && this.getPieceColor(piece) === playerColor) {
                const pieceMoves = this.findMovesForPiece(board, i);
                pieceMoves.forEach(move => {
                    if (move.isCapture) {
                        captureMoves.push(move);
                    } else {
                        moves.push(move);
                    }
                });
            }
        }

        if (captureMoves.length > 0) {
            const maxCaptureLength = Math.max(...captureMoves.map(m => m.captured.length));
            return captureMoves.filter(m => m.captured.length === maxCaptureLength);
        }

        return moves;
    },

    findMovesForPiece(board, startIndex) {
        const moves = [];
        this._findCaptureSequences(board, startIndex, [startIndex], [], moves);

        if (moves.length === 0) {
            this._findSimpleMoves(board, startIndex, moves);
        }
        return moves;
    },

    _findSimpleMoves(board, startIndex, moves) {
        const piece = board[startIndex];
        const color = this.getPieceColor(piece);
        const directions = this.isKing(piece) ? [-4, -5, 4, 5] : (color === 'white' ? [-4, -5] : [4, 5]);

        for (const dir of directions) {
            const endIndex = startIndex + dir;
            if (this.isValidPosition(endIndex) && board[endIndex] === ' ') {
                moves.push({ from: startIndex, to: endIndex, isCapture: false, captured: [] });
            }
        }
    },

    _findCaptureSequences(board, currentIndex, currentPath, capturedSoFar, allSequences) {
        const piece = board[currentPath[0]];
        const color = this.getPieceColor(piece);
        const opponentColorChar = color === 'white' ? 'b' : 'w';
        const directions = this.isKing(piece) ? [-4, -5, 4, 5] : [-4, -5, 4, 5]; 

        let foundCaptureInThisPath = false;

        for (const dir of directions) {
            const jumpOverIndex = currentIndex + dir;
            const landIndex = currentIndex + 2 * dir;

            if (this.isValidPosition(landIndex) && board[landIndex] === ' ' && this.isValidPosition(jumpOverIndex) && board[jumpOverIndex].toLowerCase() === opponentColorChar) {
                if (capturedSoFar.includes(jumpOverIndex)) continue;

                const newBoard = [...board];
                newBoard[currentIndex] = ' ';
                newBoard[jumpOverIndex] = ' ';
                newBoard[landIndex] = piece;

                const newPath = [...currentPath, landIndex];
                const newCaptured = [...capturedSoFar, jumpOverIndex];
                
                foundCaptureInThisPath = true;
                this._findCaptureSequences(newBoard, landIndex, newPath, newCaptured, allSequences);
            }
        }

        if (!foundCaptureInThisPath && capturedSoFar.length > 0) {
            allSequences.push({
                from: currentPath[0],
                to: currentIndex,
                isCapture: true,
                captured: capturedSoFar,
                path: currentPath
            });
        }
    },
    
    checkWinner(board, currentPlayerColor) {
        const opponentColor = this.getOpponentColor(currentPlayerColor);
        const opponentMoves = this.findAllPossibleMoves(board, opponentColor);

        if (opponentMoves.length === 0) {
            return currentPlayerColor; 
        }

        let opponentHasPieces = false;
        for(const p of board) {
            if (p !== ' ' && this.getPieceColor(p) === opponentColor) {
                opponentHasPieces = true;
                break;
            }
        }
        if(!opponentHasPieces) {
             return currentPlayerColor;
        }

        return null; 
    }
};

const processEndGame = async (game, winnerId, loserId, io) => {
    if (game.status === 'completed') return;

    game.status = 'completed';
    game.winner = winnerId;
    game.loser = loserId;
    game.completedAt = new Date();
    await game.save();

    const winner = await User.findById(winnerId);
    const loser = await User.findById(loserId);
    
    winner.wins += 1;
    loser.losses += 1;

    if (game.betAmount > 0) {
        const totalPot = game.betAmount;
        const commission = totalPot * 0.15;
        const prize = totalPot - commission;
        const balanceType = game.isDemoGame ? 'demoBalance' : 'balance';
        
        winner[balanceType] += prize;
        
        await Transaction.create([
            { user: winnerId, type: 'game_win', amount: prize, status: 'completed', method: 'game', relatedGame: game._id },
            { user: winnerId, type: 'game_fee', amount: commission, status: 'completed', method: 'platform', relatedGame: game._id }
        ]);
    }
    
    await winner.save();
    await loser.save();

    const populatedGame = await Game.findById(game._id).populate('winner', 'username').populate('loser', 'username');
    io.to(game._id.toString()).emit('game_over', populatedGame);
};


module.exports = function(io) {
    io.on('connection', (socket) => {
        
        socket.on('join_lobby_game', async ({ lobbyGameId, userId }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const lobbyGame = await LobbyGame.findById(lobbyGameId).session(session);
                if (!lobbyGame) {
                    throw new Error('Aposta não encontrada ou expirada.');
                }

                const creator = await User.findById(lobbyGame.createdBy).session(session);
                const joiner = await User.findById(userId).session(session);

                if (!creator || !joiner) throw new Error('Jogador não encontrado.');
                if (creator._id.equals(joiner._id)) throw new Error('Não pode jogar consigo mesmo.');
                
                const bet = lobbyGame.betAmount;
                const balanceType = lobbyGame.isDemoGame ? 'demoBalance' : 'balance';
                if (creator[balanceType] < bet || joiner[balanceType] < bet) {
                     throw new Error('Saldo insuficiente para um dos jogadores.');
                }
                
                creator[balanceType] -= bet;
                joiner[balanceType] -= bet;
                
                await creator.save({ session });
                await joiner.save({ session });
                
                const players = [creator._id, joiner._id];
                const startingPlayerId = players[Math.floor(Math.random() * 2)];
                const newGame = new Game({
                    players: players,
                    playerColors: { [creator._id]: 'white', [joiner._id]: 'black' },
                    boardState: gameLogic.stringifyBoard(initialBoardArray),
                    currentPlayer: startingPlayerId,
                    betAmount: bet * 2,
                    isDemoGame: lobbyGame.isDemoGame,
                    timeLimit: lobbyGame.timeLimit,
                    status: 'in_progress'
                });

                await newGame.save({ session });
                await LobbyGame.findByIdAndDelete(lobbyGameId, { session });
                
                await session.commitTransaction();

                const gameRoom = newGame._id.toString();
                
                const allSocketsInRoom = io.sockets.adapter.rooms.get(lobbyGameId.toString());
                if (allSocketsInRoom) {
                    allSocketsInRoom.forEach(socketId => {
                        const s = io.sockets.sockets.get(socketId);
                        s.join(gameRoom);
                        s.leave(lobbyGameId.toString());
                    });
                }
                socket.join(gameRoom);

                const populatedGame = await Game.findById(newGame._id).populate('players', 'username avatar');
                io.to(gameRoom).emit('game_start', { game: populatedGame });
                 
            } catch(error) {
                await session.abortTransaction();
                socket.emit('error', { message: error.message || 'Erro ao iniciar o jogo.' });
            } finally {
                session.endSession();
            }
        });
        
        socket.on('join_game_room', async ({ gameId, userId }) => {
            socket.join(gameId);
            const game = await Game.findById(gameId).populate('players', 'username avatar');
            if (game) {
                const userColor = game.players[0]._id.equals(userId) ? 'white' : 'black';
                socket.emit('game_update', { game, userColor });
            }
        });

        socket.on('make_move', async ({ gameId, userId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;
                if (game.currentPlayer.toString() !== userId) {
                    return socket.emit('error', { message: 'Não é o seu turno.' });
                }
                
                const board = gameLogic.parseBoard(game.boardState);
                const userColor = game.playerColors[userId];
                
                const possibleMoves = gameLogic.findAllPossibleMoves(board, userColor);
                
                const isValidMove = possibleMoves.some(m => m.from === move.from && m.to === move.to);
                if (!isValidMove) {
                    return socket.emit('error', { message: 'Jogada inválida.' });
                }
                
                const chosenMove = possibleMoves.find(m => m.from === move.from && m.to === move.to);
                let piece = board[chosenMove.from];
                board[chosenMove.from] = ' ';
                if(chosenMove.isCapture) {
                    chosenMove.captured.forEach(pos => board[pos] = ' ');
                }
                
                const promotionRow = userColor === 'white' ? 0 : 7;
                const toRow = Math.floor(chosenMove.to / 4);
                if (toRow === promotionRow && !gameLogic.isKing(piece)) {
                    piece = piece.toUpperCase();
                }
                board[chosenMove.to] = piece;
                
                game.boardState = gameLogic.stringifyBoard(board);
                const nextPlayer = game.players.find(p => !p.equals(userId));
                game.currentPlayer = nextPlayer;
                game.moveHistory.push({ player: userId, move: JSON.stringify(move), boardState: game.boardState });
                
                const winnerColor = gameLogic.checkWinner(board, userColor);
                if (winnerColor) {
                    const winnerId = Object.keys(game.playerColors).find(key => game.playerColors[key] === winnerColor);
                    const loserId = game.players.find(p => !p.equals(winnerId));
                    await game.save();
                    await processEndGame(game, winnerId, loserId, io);
                } else {
                    await game.save();
                    io.to(gameId).emit('game_update', { game });
                }

            } catch(error) {
                 socket.emit('error', { message: 'Erro ao processar jogada.' });
            }
        });

        socket.on('forfeit', async ({ gameId, userId }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress') return;
                
                const loserId = userId;
                const winnerId = game.players.find(p => p.toString() !== loserId);
                if (!winnerId) return;

                await processEndGame(game, winnerId.toString(), loserId, io);
            } catch (error) {
                 socket.emit('error', { message: 'Erro ao processar desistência.' });
            }
        });

        socket.on('disconnect', () => {
            // Futuramente, implementar lógica de timer de desconexão
        });
    });
};