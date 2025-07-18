const express = require('express');
const router = express.Router();
const { Transaction, User, PaymentMethod } = require('./models');
const { protect } = require('./authMiddleware');
const upload = require('./cloudinaryConfig');

router.post('/deposit', protect, upload.single('proof'), async (req, res) => {
    const { amount, method, proofText } = req.body;
    const userId = req.user._id;

    if (!amount || !method) {
        return res.status(400).json({ message: 'Valor e método são obrigatórios.' });
    }

    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount < 50) {
        return res.status(400).json({ message: 'O valor mínimo para depósito é 50 MT.' });
    }

    if (!req.file && !proofText) {
        return res.status(400).json({ message: 'É necessário enviar um comprovativo (imagem ou texto).' });
    }

    try {
        const paymentMethod = await PaymentMethod.findOne({ _id: method, isActive: true });
        if (!paymentMethod) {
            return res.status(404).json({ message: 'Método de pagamento não encontrado ou inativo.' });
        }

        const newTransaction = new Transaction({
            user: userId,
            type: 'deposit',
            amount: depositAmount,
            method: paymentMethod.name,
            status: 'pending',
            proof: req.file ? req.file.path : proofText
        });

        await newTransaction.save();

        res.status(201).json({ message: 'Pedido de depósito enviado com sucesso. Aguardando aprovação.', transaction: newTransaction });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao processar o pedido de depósito.', error: error.message });
    }
});

router.post('/withdraw', protect, async (req, res) => {
    const { amount, method, accountNumber } = req.body;
    const userId = req.user._id;

    if (!amount || !method || !accountNumber) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios para o levantamento.' });
    }

    const withdrawalAmount = parseFloat(amount);
    if (isNaN(withdrawalAmount) || withdrawalAmount < 50) {
        return res.status(400).json({ message: 'O valor mínimo para levantamento é 50 MT.' });
    }

    try {
        const user = await User.findById(userId);
        if (user.balance < withdrawalAmount) {
            return res.status(400).json({ message: 'Saldo insuficiente.' });
        }

        user.balance -= withdrawalAmount;
        
        const newTransaction = new Transaction({
            user: userId,
            type: 'withdrawal',
            amount: withdrawalAmount,
            status: 'pending',
            method: `${method} - ${accountNumber}`,
            proof: `Levantamento para: ${accountNumber}`
        });

        await newTransaction.save();
        await user.save();

        res.status(201).json({ message: 'Pedido de levantamento enviado com sucesso. Aguardando aprovação.', transaction: newTransaction });

    } catch (error) {
        res.status(500).json({ message: 'Erro ao processar o pedido de levantamento.' });
    }
});


router.get('/history', protect, async (req, res) => {
    try {
        const transactions = await Transaction.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(transactions);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar histórico de transações.' });
    }
});

module.exports = router;