const express = require('express');
const router = express.Router();
const { User } = require('./models');
const { protect } = require('./authMiddleware');
const upload = require('./cloudinaryConfig');
const bcrypt = require('bcryptjs');

router.get('/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

router.put('/profile', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (user) {
            user.username = req.body.username || user.username;
            user.bio = req.body.bio || user.bio;
            const updatedUser = await user.save();
            res.json({
                _id: updatedUser._id,
                username: updatedUser.username,
                email: updatedUser.email,
                bio: updatedUser.bio,
            });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar perfil.' });
    }
});

router.post('/profile/avatar', protect, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Nenhum arquivo enviado.' });
        }
        const user = await User.findById(req.user._id);
        if (user) {
            if (user.avatar && user.avatar.public_id) {
                 // await cloudinary.uploader.destroy(user.avatar.public_id);
            }
            user.avatar = {
                url: req.file.path,
                public_id: req.file.filename
            };
            await user.save();
            res.json({ message: 'Avatar atualizado com sucesso.', avatar: user.avatar });
        } else {
            res.status(404).json({ message: 'Usuário não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no upload do avatar.', error: error.message });
    }
});

router.put('/profile/password', protect, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    try {
        const user = await User.findById(req.user._id);
        if (user && (await user.matchPassword(currentPassword))) {
            user.password = newPassword;
            await user.save();
            res.json({ message: 'Senha alterada com sucesso.' });
        } else {
            res.status(401).json({ message: 'Senha atual incorreta.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro ao alterar a senha.' });
    }
});


router.get('/ranking', protect, async (req, res) => {
    try {
        const users = await User.find({ role: 'user' })
            .sort({ wins: -1, losses: 1 })
            .select('username avatar wins losses createdAt bio');
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar o ranking.' });
    }
});


router.get('/:username', protect, async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('-password -email -balance -demoBalance -role');
        if (user) {
            res.json(user);
        } else {
            res.status(404).json({ message: 'Jogador não encontrado.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro ao buscar perfil do jogador.' });
    }
});

module.exports = router;