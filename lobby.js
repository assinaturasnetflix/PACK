const express = require('express');
const router = express.Router();
const { LobbyGame, User, Game } = require('./models');
const { protect } = require('./authMiddleware');
const { customAlphabet } = require('nanoid');

const generatePrivateCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 6);

router.post('/create', protect, async (req, res) => {
    let { betAmount, isPrivate, description, timeLimit, isDemoGame } = req.body;
    const creatorId = req.user._id;

    betAmount = Number(betAmount);
    if (isNaN(betAmount) || betAmount < 0) {
        return res.status(400).json({ message: 'Valor da aposta inválido.' });
    }

    try {
        const user = await User.findById(creatorId);
        const balanceToCheck = isDemoGame ? user.demoBalance : user.balance;

        if (balanceToCheck < betAmount) {
            return res.status(400).json({ message: 'Saldo insuficiente para criar esta aposta.' });
        }
        
        const existingGame = await LobbyGame.findOne({ createdBy: creatorId });
        if(existingGame){
            return res.status(400).json({ message: 'Você já tem uma aposta ativa no lobby.' });
        }

        const lobbyData = {
            createdBy: creatorId,
            betAmount,
            isDemoGame,
            description: description || '',
            timeLimit: timeLimit || null,
            isPrivate: !!isPrivate,
        };

        if (isPrivate) {
            lobbyData.privateCode = generatePrivateCode();
        }

        const lobbyGame = new LobbyGame(lobbyData);
        await lobbyGame.save();

        res.status(201).json(lobbyGame);

    } catch (error) {
        res.status(500).json({ message: 'Erro ao criar aposta no lobby.', error: error.message });
    }
});

router.get('/public', protect, async (req, res) => {
    try {
        const publicGames = await LobbyGame.find({ isPrivate: false, createdBy: { $ne: req.user._id } })
            .populate('createdBy', 'username avatar')
            .sort({ createdAt: -1 });
            
        res.json(publicGames);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar apostas públicas.' });
    }
});

router.post('/join/private', protect, async (req, res) => {
    const { privateCode } = req.body;
    const joinerId = req.user._id;

    if (!privateCode) {
        return res.status(400).json({ message: 'Código da partida privada é obrigatório.' });
    }

    try {
        const lobbyGame = await LobbyGame.findOne({ privateCode });

        if (!lobbyGame) {
            return res.status(404).json({ message: 'Partida privada não encontrada ou expirada.' });
        }

        if (lobbyGame.createdBy.toString() === joinerId) {
            return res.status(400).json({ message: 'Você não pode entrar na sua própria partida privada.' });
        }

        res.status(200).json({ message: 'Código válido. Entrando na partida...', lobbyGameId: lobbyGame._id });

    } catch (error) {
        res.status(500).json({ message: 'Erro ao entrar na partida privada.' });
    }
});


router.get('/history', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const games = await Game.find({
            players: userId,
            status: { $in: ['completed', 'abandoned'] }
        })
        .populate('players', 'username avatar')
        .populate('winner', 'username')
        .populate('loser', 'username')
        .sort({ completedAt: -1 });
        
        res.json(games);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico de partidas.' });
    }
});


router.get('/active-game', protect, async (req, res) => {
    try {
        const userId = req.user._id;
        const activeGame = await Game.findOne({
            players: userId,
            status: 'in_progress'
        }).populate('players', 'username avatar');

        if (activeGame) {
            res.json(activeGame);
        } else {
            res.json(null);
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro ao verificar partida ativa.' });
    }
});


router.post('/game/:id/forfeit', protect, async (req, res) => {
    try {
        const gameId = req.params.id;
        const userId = req.user._id;

        const game = await Game.findById(gameId);

        if (!game || game.status !== 'in_progress' || !game.players.includes(userId)) {
            return res.status(400).json({ message: 'Partida não encontrada ou inválida para desistência.' });
        }
        
        res.status(200).json({ message: 'Desistência processada.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao processar desistência.' });
    }
});


module.exports = router;