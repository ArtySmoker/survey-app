// models/Survey.js
const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  type: { type: String, required: true }, // "text", "single", "multiple", "photo"
  question: { type: String, required: true },
  options: [{ type: String }] // Не используется для "photo"
});

const surveySchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  questions: [questionSchema],
  responseCount: { type: Number, default: 0 }
});

module.exports = mongoose.model('Survey', surveySchema);