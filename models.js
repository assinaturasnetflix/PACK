const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const PasswordResetSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true, default: () => Date.now() + 15 * 60 * 1000, index: { expires: '15m' } }
});

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    avatar: {
        url: { type: String, default: null },
        public_id: { type: String, default: null }
    },
    bio: { type: String, maxlength: 150, default: '' },
    balance: { type: Number, default: 0 },
    demoBalance: { type: Number, default: 500 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isBlocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

UserSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

const TransactionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['deposit', 'withdrawal', 'game_win', 'game_fee', 'refund', 'manual_credit', 'manual_debit'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'completed'], default: 'pending' },
    method: { type: String, required: true },
    proof: { type: String },
    transactionId: { type: String, unique: true },
    adminNotes: { type: String },
    relatedGame: { type: mongoose.Schema.Types.ObjectId, ref: 'Game' },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

TransactionSchema.pre('save', function(next) {
    if (this.isNew) {
        this.transactionId = `TRN-${Date.now()}${(Math.random() * 1000).toFixed(0).padStart(3, '0')}`;
    }
    this.updatedAt = Date.now();
    next();
});

const GameSchema = new mongoose.Schema({
    gameId: { type: String, unique: true },
    players: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    boardState: { type: String, required: true },
    currentPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['waiting', 'in_progress', 'completed', 'abandoned'], default: 'waiting' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    loser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    betAmount: { type: Number, default: 0 },
    isDemoGame: { type: Boolean, default: false },
    timeLimit: { type: Number, default: null },
    moveHistory: [{
        player: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        move: { type: String },
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date }
});

GameSchema.pre('save', function(next) {
    if (this.isNew) {
        this.gameId = `GM-${Date.now()}${(Math.random() * 1000).toFixed(0).padStart(3, '0')}`;
    }
    next();
});

const LobbyGameSchema = new mongoose.Schema({
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    betAmount: { type: Number, required: true },
    isDemoGame: { type: Boolean, required: true },
    description: { type: String, maxlength: 100 },
    timeLimit: { type: Number, default: null },
    isPrivate: { type: Boolean, default: false },
    privateCode: { type: String, unique: true, sparse: true },
    createdAt: { type: Date, default: Date.now, expires: '2m' }
});


const PaymentMethodSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    accountNumber: { type: String, required: true },
    accountName: { type: String, required: true },
    instructions: { type: String, required: true },
    isActive: { type: Boolean, default: true }
});

const NotificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});


const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const Game = mongoose.model('Game', GameSchema);
const PasswordReset = mongoose.model('PasswordReset', PasswordResetSchema);
const LobbyGame = mongoose.model('LobbyGame', LobbyGameSchema);
const PaymentMethod = mongoose.model('PaymentMethod', PaymentMethodSchema);
const Notification = mongoose.model('Notification', NotificationSchema);

module.exports = { User, Transaction, Game, PasswordReset, LobbyGame, PaymentMethod, Notification };