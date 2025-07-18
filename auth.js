const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const fetch = require('node-fetch');
const { User, PasswordReset } = require('./models');
require('dotenv').config();

const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '1d' });
};

router.post('/register', async (req, res) => {
    const { username, email, password, recaptchaToken } = req.body;

    if (!username || !email || !password || !recaptchaToken) {
        return res.status(400).json({ message: 'Por favor, preencha todos os campos.' });
    }

    try {
        const secretKey = process.env.RECAPTCHA_SECRET_KEY;
        const verificationURL = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptchaToken}`;
        const recaptchaRes = await fetch(verificationURL, { method: 'POST' });
        const recaptchaData = await recaptchaRes.json();
        
        if (!recaptchaData.success || recaptchaData.score < 0.5) {
             return res.status(400).json({ message: 'Falha na verificação reCAPTCHA. Tente novamente.' });
        }

        const userExists = await User.findOne({ $or: [{ email }, { username }] });
        if (userExists) {
            return res.status(400).json({ message: 'Usuário ou email já cadastrado.' });
        }

        const user = await User.create({ username, email, password });

        if (user) {
            res.status(201).json({
                _id: user._id,
                username: user.username,
                email: user.email,
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ message: 'Dados de usuário inválidos.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor. Tente novamente mais tarde.' });
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (user && (await user.matchPassword(password))) {
             if (user.isBlocked) {
                return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
            }
            user.lastSeen = Date.now();
            await user.save();
            res.json({
                _id: user._id,
                username: user.username,
                email: user.email,
                role: user.role,
                token: generateToken(user._id),
            });
        } else {
            res.status(401).json({ message: 'Email ou senha inválidos.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

router.post('/request-password-reset', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Nenhum usuário encontrado com este email.' });
        }
        
        await PasswordReset.deleteMany({ userId: user._id });

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        await new PasswordReset({ userId: user._id, code }).save();

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS,
            },
        });

        const emailHTML = `
            <div style="font-family: 'Oswald', sans-serif; color: #333; background-color: #f4f4f4; padding: 20px; text-align: center;">
                <div style="max-width: 600px; margin: auto; background-color: #ffffff; border: 1px solid #ddd; padding: 30px;">
                    <h1 style="color: #000000; font-size: 28px;">BrainSkill - Recuperação de Senha</h1>
                    <p style="font-size: 18px;">Olá, ${user.username}!</p>
                    <p style="font-size: 16px;">Recebemos uma solicitação para redefinir a senha da sua conta.</p>
                    <p style="font-size: 16px;">Use o código abaixo para concluir o processo:</p>
                    <div style="font-size: 36px; font-weight: bold; color: #000; background-color: #f0f0f0; padding: 15px 20px; margin: 20px 0; display: inline-block;">
                        ${code}
                    </div>
                    <p style="font-size: 14px; color: #777;">Este código é válido por 15 minutos. Se você não solicitou esta alteração, por favor, ignore este email.</p>
                    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="font-size: 12px; color: #999;">© ${new Date().getFullYear()} BrainSkill. Todos os direitos reservados.</p>
                </div>
            </div>
        `;
        
        await transporter.sendMail({
            from: `"BrainSkill" <${process.env.EMAIL_USER}>`,
            to: user.email,
            subject: 'Seu Código de Recuperação de Senha',
            html: emailHTML
        });

        res.status(200).json({ message: 'Email com código de recuperação enviado.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao enviar o email.' });
    }
});


router.post('/verify-reset-code', async (req, res) => {
    const { email, code } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const resetRequest = await PasswordReset.findOne({ userId: user._id, code });
        if (!resetRequest) {
            return res.status(400).json({ message: 'Código inválido ou expirado.' });
        }
        
        res.status(200).json({ message: 'Código verificado com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro no servidor.' });
    }
});

router.post('/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'Usuário não encontrado.' });
        }

        const resetRequest = await PasswordReset.findOne({ userId: user._id, code });
        if (!resetRequest) {
            return res.status(400).json({ message: 'Código inválido ou expirado.' });
        }

        user.password = newPassword;
        await user.save();

        await PasswordReset.deleteOne({ _id: resetRequest._id });

        res.status(200).json({ message: 'Senha redefinida com sucesso.' });
    } catch (error) {
        res.status(500).json({ message: 'Erro ao redefinir a senha.' });
    }
});

module.exports = router;