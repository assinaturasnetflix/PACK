const { User, Game, Transaction, LobbyGame } = require('./models');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const connectedUsers = {}; 
const disconnectionTimers = {};
const DISCONNECTION_TIMEOUT = 60000;

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

const gameLogic = {
    parseBoard(boardState) {
        return boardState.split(',');
    },
    stringifyBoard(boardArray) {
        return boardArray.join(',');
    },
    getPieceColor(piece) {
        if (piece === ' ') return null;
        return piece.toLowerCase() === 'w' ? 'white' : 'black';
    },
    isKing(piece) {
        return piece === 'W' || piece === 'B';
    },
    getOpponentColor(color) {
        return color === 'white' ? 'black' : 'white';
    },
    isValidBoardIndex(index) {
        return index >= 0 && index < 32;
    },
    findAllPossibleMoves(board, playerColor) {
        let captureMoves = [];
        for (let i = 0; i < board.length; i++) {
            if (board[i] !== ' ' && this.getPieceColor(board[i]) === playerColor) {
                this._findCaptureSequencesForPiece(i, board, [i], [], captureMoves);
            }
        }
        if (captureMoves.length > 0) {
            const maxLen = Math.max(...captureMoves.map(m => m.captured.length));
            return captureMoves.filter(m => m.captured.length === maxLen);
        }
        let simpleMoves = [];
        for (let i = 0; i < board.length; i++) {
             if (board[i] !== ' ' && this.getPieceColor(board[i]) === playerColor) {
                this._findSimpleMovesForPiece(i, board, simpleMoves);
             }
        }
        return simpleMoves;
    },
    _findSimpleMovesForPiece(start, board, moves) {
        const piece = board[start];
        const pieceColor = this.getPieceColor(piece);
        const isWhite = pieceColor === 'white';
        const moveDirs = this.isKing(piece) ? [-4, -5, 4, 5, -3, 3] : (isWhite ? [-4, -5, -3] : [4, 5, 3]);
        const startRow = Math.floor(start / 4);

        for (const dir of moveDirs) {
            const end = start + dir;
            if (!this.isValidBoardIndex(end) || board[end] !== ' ') continue;

            const endRow = Math.floor(end / 4);
            const rowDiff = Math.abs(startRow - endRow);
            if (rowDiff !== 1) continue;

            const isForward = isWhite ? (endRow < startRow) : (endRow > startRow);
            if (this.isKing(piece) || isForward) {
                 moves.push({ from: start, to: end, isCapture: false, captured: [] });
            }
        }
    },
    _findCaptureSequencesForPiece(currentPos, board, path, captured, sequences) {
        const piece = board[path[0]];
        const pieceColor = this.getPieceColor(piece);
        const opponentColor = this.getOpponentColor(pieceColor);
        const isWhite = pieceColor === 'white';
        const moveDirs = this.isKing(piece) ? [-4, -5, 4, 5, -3, 3] : (isWhite ? [-4, -5, -3] : [4, 5, 3]);

        let canContinueCapture = false;
        for (const dir of moveDirs) {
            const jumpedPos = currentPos + dir;
            const endPos = currentPos + (2 * dir);

            if (this.isValidBoardIndex(endPos) && board[endPos] === ' ' && this.isValidBoardIndex(jumpedPos) && this.getPieceColor(board[jumpedPos]) === opponentColor && !captured.includes(jumpedPos)) {
                canContinueCapture = true;
                const nextBoard = [...board];
                nextBoard[jumpedPos] = ' ';
                const newCaptured = [...captured, jumpedPos];
                const newPath = [...path, endPos];
                this._findCaptureSequencesForPiece(endPos, nextBoard, newPath, newCaptured, sequences);
            }
        }
        if (!canContinueCapture && captured.length > 0) {
            sequences.push({ from: path[0], to: currentPos, isCapture: true, captured: captured, path: path.slice(1) });
        }
    },
    checkWinner(board, currentPlayerColor) {
        const opponentColor = this.getOpponentColor(currentPlayerColor);
        const opponentMoves = this.findAllPossibleMoves(board, opponentColor);
        if (opponentMoves.length === 0) {
            return currentPlayerColor;
        }
        return null;
    }
};

const processEndGame = async (game, winnerId, loserId, io, reason = 'game_completed') => {
    if (game.status === 'completed' || game.status === 'abandoned') return;

    if (disconnectionTimers[game._id.toString()]) {
        clearTimeout(disconnectionTimers[game._id.toString()].timer);
        delete disconnectionTimers[game._id.toString()];
    }

    game.status = reason === 'abandoned' ? 'abandoned' : 'completed';
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

        socket.on('authenticate_socket', async (token) => {
            if (!token) return;
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const userId = decoded.id;
                connectedUsers[socket.id] = userId;

                const activeGame = await Game.findOne({ players: userId, status: 'in_progress' });
                if (activeGame) {
                    const gameRoom = activeGame._id.toString();
                    socket.join(gameRoom);

                    if (disconnectionTimers[gameRoom] && disconnectionTimers[gameRoom].disconnectedUserId === userId) {
                        clearTimeout(disconnectionTimers[gameRoom].timer);
                        delete disconnectionTimers[gameRoom];
                        const user = await User.findById(userId);
                        io.to(gameRoom).emit('player_reconnected', { username: user.username });
                    }
                }
            } catch (error) {
                console.warn(`Tentativa de autenticação de socket falhou: ${error.message}`);
                socket.emit('auth_failed');
            }
        });

        socket.on('join_lobby_game', async ({ lobbyGameId, userId }) => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const lobbyGame = await LobbyGame.findById(lobbyGameId).session(session);
                if (!lobbyGame) throw new Error('Aposta não encontrada ou expirada.');

                const creator = await User.findById(lobbyGame.createdBy).session(session);
                const joiner = await User.findById(userId).session(session);

                if (!creator || !joiner) throw new Error('Jogador não encontrado.');
                if (creator._id.equals(joiner._id)) throw new Error('Você não pode jogar consigo mesmo.');
                
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
                const [p1, p2] = Math.random() < 0.5 ? [players[0], players[1]] : [players[1], players[0]];

                const newGame = new Game({
                    players: [p1, p2],
                    playerColors: { [p1]: 'white', [p2]: 'black' },
                    boardState: gameLogic.stringifyBoard(initialBoardArray),
                    currentPlayer: p1,
                    betAmount: bet * 2,
                    isDemoGame: lobbyGame.isDemoGame,
                    timeLimit: lobbyGame.timeLimit,
                    status: 'in_progress'
                });

                await newGame.save({ session });
                const gameRoom = newGame._id.toString();
                
                const creatorSocketId = Object.keys(connectedUsers).find(key => connectedUsers[key] === creator._id.toString());
                if (creatorSocketId) {
                    const creatorSocket = io.sockets.sockets.get(creatorSocketId);
                    if(creatorSocket) creatorSocket.join(gameRoom);
                }
                socket.join(gameRoom);
                
                io.to(gameRoom).emit('game_found', { gameId: gameRoom });

                await LobbyGame.findByIdAndDelete(lobbyGameId, { session });
                await session.commitTransaction();
                io.emit(`lobby_update_remove`, { lobbyGameId });

            } catch(error) {
                await session.abortTransaction();
                socket.emit('error', { message: error.message || 'Erro ao iniciar o jogo.' });
            } finally {
                session.endSession();
            }
        });

        socket.on('enter_game_room', async ({ gameId }) => {
            const userId = connectedUsers[socket.id];
            if (!gameId || !userId) return;

            const game = await Game.findById(gameId).populate('players', 'username avatar');
            if (game && game.players.some(p => p._id.equals(userId))) {
                socket.join(gameId);
                const userColor = game.playerColors[userId];
                io.to(socket.id).emit('game_state', { game, userColor });
            }
        });

        socket.on('make_move', async ({ gameId, userId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress' || game.currentPlayer.toString() !== userId) return;

                const board = gameLogic.parseBoard(game.boardState);
                const userColor = game.playerColors[userId];
                const possibleMoves = gameLogic.findAllPossibleMoves(board, userColor);
                
                const isValidMove = possibleMoves.some(m => m.from === move.from && m.to === move.to);
                if (!isValidMove) return socket.emit('error', { message: 'Jogada inválida.' });

                const chosenMove = possibleMoves.find(m => m.from === move.from && m.to === move.to);
                let piece = board[chosenMove.from];
                board[chosenMove.from] = ' ';
                if(chosenMove.isCapture) {
                    chosenMove.captured.forEach(pos => board[pos] = ' ');
                }
                
                const promotionRow = userColor === 'white' ? 0 : 7;
                if (Math.floor(chosenMove.to / 4) === promotionRow && !gameLogic.isKing(piece)) {
                    piece = piece.toUpperCase();
                }
                
                board[chosenMove.to] = piece;
                
                game.boardState = gameLogic.stringifyBoard(board);
                const nextPlayer = game.players.find(p => !p.equals(mongoose.Types.ObjectId(userId)));
                game.currentPlayer = nextPlayer._id;
                game.moveHistory.push({ player: userId, move: JSON.stringify(move), boardState: game.boardState });
                
                const winnerColor = gameLogic.checkWinner(board, userColor);
                if (winnerColor) {
                    const winnerId = Object.keys(game.playerColors).find(key => game.playerColors[key] === winnerColor);
                    const loserId = game.players.find(p => !p.equals(mongoose.Types.ObjectId(winnerId)));
                    await game.save();
                    await processEndGame(game, winnerId, loserId, io);
                } else {
                    await game.save();
                    io.to(gameId).emit('game_state', { game });
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

                await processEndGame(game, winnerId.toString(), loserId, io, 'abandoned');
            } catch (error) {
                 socket.emit('error', { message: 'Erro ao processar desistência.' });
            }
        });

        socket.on('disconnect', async () => {
            const userId = connectedUsers[socket.id];
            delete connectedUsers[socket.id];
            if (!userId) return;

            try {
                const game = await Game.findOne({ players: userId, status: 'in_progress' });
                if (game) {
                    const gameRoom = game._id.toString();
                    const disconnectedPlayer = await User.findById(userId);
                    
                    io.to(gameRoom).emit('player_disconnected', {
                        username: disconnectedPlayer.username,
                        timeout: DISCONNECTION_TIMEOUT / 1000
                    });

                    const timer = setTimeout(async () => {
                        const gameToEnd = await Game.findById(game._id);
                        if (gameToEnd && gameToEnd.status === 'in_progress') {
                            const winnerId = gameToEnd.players.find(p => p.toString() !== userId);
                            await processEndGame(gameToEnd, winnerId, userId, io, 'abandoned');
                        }
                        delete disconnectionTimers[gameRoom];
                    }, DISCONNECTION_TIMEOUT);
                    
                    disconnectionTimers[gameRoom] = { timer, disconnectedUserId: userId };
                }
            } catch (error) {
                console.error(`Erro no evento de desconexão para o usuário ${userId}:`, error);
            }
        });
    });
};