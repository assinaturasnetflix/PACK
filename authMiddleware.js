const jwt = require('jsonwebtoken');
const { User } = require('./models');
require('dotenv').config();

const protect = async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            if (!req.user || req.user.isBlocked) {
                return res.status(401).json({ message: 'Não autorizado, token falhou ou usuário bloqueado.' });
            }
            next();
        } catch (error) {
            res.status(401).json({ message: 'Não autorizado, token inválido.' });
        }
    }
    if (!token) {
        res.status(401).json({ message: 'Não autorizado, sem token.' });
    }
};

const admin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Acesso negado. Rota exclusiva para administradores.' });
    }
};

module.exports = { protect, admin };