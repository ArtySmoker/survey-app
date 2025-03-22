const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  type: { type: String, required: true }, 
  question: { type: String, required: true },
  options: [{ type: String }] 
});

const surveySchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  questions: [questionSchema],
  responseCount: { type: Number, default: 0 }
});

module.exports = mongoose.model('Survey', surveySchema);