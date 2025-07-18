const express = require('express');
const router = express.Router();
const { User, Transaction, Game, PaymentMethod } = require('./models');
const { protect, admin } = require('./authMiddleware');

router.get('/stats', protect, admin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({ role: 'user' });
        
        const deposits = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const withdrawals = await Transaction.aggregate([
            { $match: { type: 'withdrawal', status: 'approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        
        const platformFees = await Transaction.aggregate([
            { $match: { type: 'game_fee' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.json({
            totalUsers,
            totalDeposited: deposits.length > 0 ? deposits[0].total : 0,
            totalWithdrawn: withdrawals.length > 0 ? withdrawals[0].total : 0,
            totalCommission: platformFees.length > 0 ? platformFees[0].total : 0
        });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar estatísticas.' });
    }
});

router.get('/users', protect, admin, async (req, res) => {
    try {
        const users = await User.find({}).select('-password');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar usuários.' });
    }
});

router.put('/users/:id/toggle-block', protect, admin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
        if (user.role === 'admin') return res.status(400).json({ message: 'Não é possível bloquear um administrador.'});
        
        user.isBlocked = !user.isBlocked;
        await user.save();
        res.json({ message: `Usuário ${user.isBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso.` });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao alterar status do usuário.' });
    }
});

router.get('/transactions', protect, admin, async (req, res) => {
    try {
        const transactions = await Transaction.find().populate('user', 'username email').sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar transações.' });
    }
});

router.put('/transactions/:id/approve', protect, admin, async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id);
        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ message: 'Transação não encontrada ou já processada.' });
        }

        const user = await User.findById(transaction.user);
        if (!user) return res.status(404).json({ message: 'Usuário associado não encontrado.' });

        if (transaction.type === 'deposit') {
            user.balance += transaction.amount;
        } 
        
        transaction.status = 'approved';
        await user.save();
        await transaction.save();
        res.json({ message: 'Transação aprovada com sucesso.' });

    } catch (error) {
        res.status(500).json({ message: 'Erro ao aprovar transação.' });
    }
});

router.put('/transactions/:id/reject', protect, admin, async (req, res) => {
    const { adminNotes } = req.body;
    try {
        const transaction = await Transaction.findById(req.params.id);
        if (!transaction || transaction.status !== 'pending') {
            return res.status(404).json({ message: 'Transação não encontrada ou já processada.' });
        }
        
        if (transaction.type === 'withdrawal') {
            const user = await User.findById(transaction.user);
            user.balance += transaction.amount; // Devolve o saldo
            await user.save();
        }

        transaction.status = 'rejected';
        transaction.adminNotes = adminNotes || 'Recusado pelo administrador.';
        await transaction.save();

        res.json({ message: 'Transação recusada com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao recusar transação.' });
    }
});

router.post('/users/balance', protect, admin, async (req, res) => {
    const { userId, amount, type, reason } = req.body;
    const adminId = req.user._id;

    const parsedAmount = parseFloat(amount);
    if (!userId || isNaN(parsedAmount) || !type || !reason) {
        return res.status(400).json({ message: 'Dados inválidos.' });
    }
    
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });

        let transactionType;
        if (type === 'credit') {
            user.balance += parsedAmount;
            transactionType = 'manual_credit';
        } else if (type === 'debit') {
            user.balance -= parsedAmount;
            transactionType = 'manual_debit';
        } else {
            return res.status(400).json({ message: 'Tipo de operação inválido.' });
        }

        const transaction = new Transaction({
            user: userId,
            type: transactionType,
            amount: parsedAmount,
            status: 'completed',
            method: 'manual',
            proof: `Ajuste manual pelo Admin ID: ${adminId}. Motivo: ${reason}`
        });

        await user.save();
        await transaction.save();

        res.json({ message: 'Saldo ajustado com sucesso.', newBalance: user.balance });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao ajustar saldo do usuário.' });
    }
});


router.get('/users/:id/history', protect, admin, async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId).select('-password');
        if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
        
        const transactions = await Transaction.find({ user: userId }).sort({ createdAt: -1 });
        const games = await Game.find({ players: userId }).populate('players', 'username').sort({ createdAt: -1 });

        res.json({ user, transactions, games });

    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico do usuário.' });
    }
});

module.exports = router;