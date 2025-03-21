// models/Response.js
const mongoose = require('mongoose');

const responseSchema = new mongoose.Schema({
  surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
  answers: [{
    question: String,
    answer: mongoose.Schema.Types.Mixed, // строка, массив строк или пустое для "photo"
    filePath: String // Путь к файлу для типа "photo"
  }],
  timeSpent: Number, // в секундах
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Response', responseSchema);