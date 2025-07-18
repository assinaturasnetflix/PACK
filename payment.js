const express = require('express');
const router = express.Router();
const { PaymentMethod } = require('./models');
const { protect, admin } = require('./authMiddleware');

router.get('/', protect, async (req, res) => {
    try {
        const methods = await PaymentMethod.find({ isActive: true }).select('-__v');
        res.json(methods);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar métodos de pagamento.' });
    }
});

router.post('/', protect, admin, async (req, res) => {
    const { name, accountNumber, accountName, instructions } = req.body;
    if (!name || !accountNumber || !accountName || !instructions) {
        return res.status(400).json({ message: 'Todos os campos são obrigatórios.' });
    }
    try {
        const newMethod = new PaymentMethod({ name, accountNumber, accountName, instructions });
        await newMethod.save();
        res.status(201).json({ message: 'Método de pagamento adicionado com sucesso.', method: newMethod });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao adicionar método de pagamento.' });
    }
});

router.put('/:id', protect, admin, async (req, res) => {
    try {
        const method = await PaymentMethod.findByIdAndUpdate(req.params.id, req.body, { new: true });
        if (!method) {
            return res.status(404).json({ message: 'Método de pagamento não encontrado.' });
        }
        res.json({ message: 'Método de pagamento atualizado com sucesso.', method });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar o método.' });
    }
});

router.delete('/:id', protect, admin, async (req, res) => {
    try {
        const method = await PaymentMethod.findByIdAndDelete(req.params.id);
        if (!method) {
            return res.status(404).json({ message: 'Método de pagamento não encontrado.' });
        }
        res.json({ message: 'Método de pagamento removido com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao remover o método.' });
    }
});

module.exports = router;