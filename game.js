const { User, Game, Transaction, LobbyGame } = require('./models');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const connectedUsers = {}; 
const disconnectionTimers = {};
const readyStates = {};
const DISCONNECTION_TIMEOUT = 60000;

const initialBoardArray = [
    'b',' ','b',' ','b',' ','b',' ',
    ' ','b',' ','b',' ','b',' ','b',
    'b',' ','b',' ','b',' ','b',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',
    ' ',' ',' ',' ',' ',' ',' ',' ',
    ' ','w',' ','w',' ','w',' ','w',
    'w',' ','w',' ','w',' ','w',' ',
    ' ','w',' ','w',' ','w',' ','w'
].map(p => p === ' ' ? null : p);

const gameLogic = {
    parseBoard: (boardState) => boardState.split(',').map(p => p === '' ? null : p),
    stringifyBoard: (boardArray) => boardArray.map(p => p === null ? '' : p).join(','),
    getPieceColor: (piece) => piece ? (piece.toLowerCase() === 'w' ? 'white' : 'black') : null,
    isKing: (piece) => piece ? piece === piece.toUpperCase() : false,
    getOpponentColor: (color) => color === 'white' ? 'black' : 'white',

    findAllPossibleMoves: (board, playerColor) => {
        let captureMoves = [];
        for (let i = 0; i < board.length; i++) {
            if (board[i] && gameLogic.getPieceColor(board[i]) === playerColor) {
                const pieceCaptures = gameLogic.getCaptureMovesForPiece(i, board, playerColor);
                if (pieceCaptures.length > 0) captureMoves.push(...pieceCaptures);
            }
        }
        if (captureMoves.length > 0) {
            const maxLen = Math.max(...captureMoves.map(m => m.captured.length));
            return captureMoves.filter(m => m.captured.length === maxLen);
        }
        let simpleMoves = [];
        for (let i = 0; i < board.length; i++) {
            if (board[i] && gameLogic.getPieceColor(board[i]) === playerColor) {
                simpleMoves.push(...gameLogic.getSimpleMovesForPiece(i, board, playerColor));
            }
        }
        return simpleMoves;
    },

    _getCaptureMovesRecursive: (start, board, color, path, captured, sequences) => {
        const piece = board[path[0]];
        const directions = [-9, -7, 7, 9];
        let canContinue = false;

        for (const dir of directions) {
            const jumpOver = start + dir;
            const land = start + 2 * dir;
            
            if (board[land] === null && board[jumpOver] && gameLogic.getPieceColor(board[jumpOver]) !== color && !captured.includes(jumpOver)) {
                canContinue = true;
                const newBoard = [...board];
                newBoard[land] = board[start];
                newBoard[start] = null;
                newBoard[jumpOver] = null;
                gameLogic._getCaptureMovesRecursive(land, newBoard, color, [...path, land], [...captured, jumpOver], sequences);
            }
        }
        if (!canContinue && captured.length > 0) {
            sequences.push({ from: path[0], to: start, isCapture: true, captured: captured, path: path.slice(1) });
        }
    },

    getCaptureMovesForPiece: (start, board, color) => {
        let sequences = [];
        gameLogic._getCaptureMovesRecursive(start, board, color, [start], [], sequences);
        return sequences;
    },

    getSimpleMovesForPiece: (start, board, color) => {
        let moves = [];
        const piece = board[start];
        const isWhite = color === 'white';
        const directions = gameLogic.isKing(piece) ? [-9, -7, 7, 9] : (isWhite ? [-9, -7] : [7, 9]);
        for (const dir of directions) {
            const end = start + dir;
            if (board[end] === null) {
                moves.push({ from: start, to: end, isCapture: false, captured: [] });
            }
        }
        return moves;
    }
};

const processEndGame = async (game, winnerId, loserId, io, reason = 'game_completed') => {
    // Implementar lógica de final de jogo
};

module.exports = function(io) {
    io.on('connection', (socket) => {
        
        socket.on('authenticate_socket', async (token) => {
            if (!token) return;
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                connectedUsers[socket.id] = decoded.id;
            } catch (error) {
                socket.emit('auth_failed');
            }
        });

        socket.on('enter_game_room', async ({ gameId }) => {
            const userId = connectedUsers[socket.id];
            if (!gameId || !userId) return;

            socket.join(gameId);
            let game = await Game.findById(gameId).populate('players', 'username avatar');

            if (!game) return socket.emit('error', { message: 'Partida não encontrada.' });

            if (!readyStates[gameId]) {
                readyStates[gameId] = {};
                game.players.forEach(p => readyStates[gameId][p._id.toString()] = false);
            }
            
            io.to(gameId).emit('waiting_for_players', game.players);
            io.to(gameId).emit('player_ready_update', readyStates[gameId]);
        });
        
        socket.on('player_ready', async ({ gameId, userId }) => {
            if (readyStates[gameId]) {
                readyStates[gameId][userId] = true;
                io.to(gameId).emit('player_ready_update', readyStates[gameId]);

                const allReady = Object.values(readyStates[gameId]).every(status => status === true);
                if (allReady) {
                    const game = await Game.findById(gameId).populate('players', 'username avatar');
                    io.to(gameId).emit('start_game', game);
                }
            }
        });

        socket.on('get_valid_moves', async ({ gameId, pieceIndex }) => {
            const game = await Game.findById(gameId);
            const userId = connectedUsers[socket.id];
            if (!game || game.currentPlayer.toString() !== userId) return;

            const board = gameLogic.parseBoard(game.boardState);
            const pieceColor = game.playerColors[userId];
            const allMoves = gameLogic.findAllPossibleMoves(board, pieceColor);

            const movesForPiece = allMoves.filter(m => m.from === pieceIndex);
            socket.emit('valid_moves_data', movesForPiece);
        });

        socket.on('make_move', async ({ gameId, userId, move }) => {
            try {
                const game = await Game.findById(gameId);
                if (!game || game.status !== 'in_progress' || game.currentPlayer.toString() !== userId) return;

                let board = gameLogic.parseBoard(game.boardState);
                const pieceColor = game.playerColors[userId];
                const allMoves = gameLogic.findAllPossibleMoves(board, pieceColor);
                
                const isValidMove = allMoves.some(m => m.from === move.from && m.to === move.to);
                if (!isValidMove) return socket.emit('error', { message: 'Jogada inválida.' });

                const chosenMove = allMoves.find(m => m.from === move.from && m.to === move.to);
                let piece = board[chosenMove.from];
                board[chosenMove.from] = null;
                
                if (chosenMove.isCapture) {
                    chosenMove.captured.forEach(pos => board[pos] = null);
                }
                
                const promotionRowWhite = [0, 1, 2, 3];
                const promotionRowBlack = [28, 29, 30, 31];
                if (pieceColor === 'white' && promotionRowWhite.includes(chosenMove.to) && !gameLogic.isKing(piece)) {
                    piece = 'W';
                } else if (pieceColor === 'black' && promotionRowBlack.includes(chosenMove.to) && !gameLogic.isKing(piece)) {
                    piece = 'B';
                }
                board[chosenMove.to] = piece;

                game.boardState = gameLogic.stringifyBoard(board);
                const nextPlayer = game.players.find(p => !p.equals(mongoose.Types.ObjectId(userId)));
                game.currentPlayer = nextPlayer._id;
                game.moveHistory.push({ player: userId, move: JSON.stringify(move) });
                
                await game.save();

                const updatedGame = await Game.findById(gameId).populate('players', 'username avatar');
                io.to(gameId).emit('game_update', updatedGame);

            } catch (error) {
                socket.emit('error', { message: 'Erro ao processar jogada.' });
            }
        });

        socket.on('disconnect', async () => {
            const userId = connectedUsers[socket.id];
            delete connectedUsers[socket.id];
            if (!userId) return;

            const gameId = Object.keys(readyStates).find(gid => readyStates[gid][userId] !== undefined);
            if (gameId) {
                delete readyStates[gameId];
            }
        });

    });
};