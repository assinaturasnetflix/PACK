const express = require('express');
const router = express.Router();
const { Notification, User } = require('./models');
const { protect, admin } = require('./authMiddleware');


router.post('/', protect, admin, async (req, res) => {
    const { title, message, userId } = req.body;
    if (!title || !message) {
        return res.status(400).json({ message: 'Título e mensagem são obrigatórios.' });
    }
    try {
        let notifications;
        if (userId) {
            notifications = [new Notification({ user: userId, title, message })];
        } else {
            const users = await User.find({ role: 'user' }).select('_id');
            notifications = users.map(user => new Notification({ user: user._id, title, message }));
        }
        
        if (notifications.length > 0) {
            await Notification.insertMany(notifications);
        }
        
        res.status(201).json({ message: 'Notificação enviada com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao enviar notificação.' });
    }
});

router.get('/', protect, async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.user._id }).sort({ createdAt: -1 });
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar notificações.' });
    }
});

router.put('/:id/read', protect, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            { isRead: true },
            { new: true }
        );
        if (!notification) {
            return res.status(404).json({ message: 'Notificação não encontrada.' });
        }
        res.json(notification);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao marcar notificação como lida.' });
    }
});

router.put('/read-all', protect, async (req, res) => {
    try {
        await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
        res.json({ message: "Todas as notificações foram marcadas como lidas." });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao marcar todas as notificações como lidas.' });
    }
});

module.exports = router;