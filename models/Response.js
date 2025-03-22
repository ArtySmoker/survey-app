const mongoose = require('mongoose');

const responseSchema = new mongoose.Schema({
  surveyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Survey' },
  answers: [{
    question: String,
    answer: mongoose.Schema.Types.Mixed, 
    filePath: String 
  }],
  timeSpent: Number, 
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Response', responseSchema);