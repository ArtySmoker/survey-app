// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const portfinder = require('portfinder');
const multer = require('multer');
const fs = require('fs');
const app = express();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

app.use(express.json()); 
app.use(express.static('public')); 
app.use('/uploads', express.static('uploads')); 

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

const Survey = require('./models/Survey');
const Response = require('./models/Response');


app.get('/api/surveys', async (req, res) => {
  const { sortBy, page = 1, limit = 10 } = req.query;
  let sortOption = {};
  if (sortBy === 'title') sortOption = { title: 1 };
  else if (sortBy === 'questions') sortOption = { 'questions.length': 1 };
  else if (sortBy === 'responseCount') sortOption = { responseCount: 1 };

  const surveys = await Survey.find()
    .sort(sortOption)
    .skip((page - 1) * limit)
    .limit(parseInt(limit));
  res.json(surveys);
});


app.post('/api/surveys', async (req, res) => {
  console.log('Raw body:', req.body);
  console.log('Type of raw body:', typeof req.body);
  console.log('Type of questions:', typeof req.body.questions);
  console.log('Questions content:', JSON.stringify(req.body.questions, null, 2));

  let data = req.body;
  if (typeof data.questions === 'string') {
    console.log('Questions is a string, parsing...');
    data.questions = JSON.parse(data.questions);
  }

  try {
    const survey = new Survey(data);
    await survey.save();
    res.status(201).json(survey);
  } catch (error) {
    console.error('Validation error:', error);
    res.status(400).json({ error: 'Validation error', message: error.message, details: error.errors });
  }
});

app.put('/api/surveys/:id', async (req, res) => {
  console.log('Updating survey with ID:', req.params.id);
  console.log('Received data:', req.body);
  try {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      console.log('Survey not found for ID:', req.params.id);
      return res.status(404).json({ error: 'Questionnaire not found' });
    }
    const updateData = { ...req.body };
    delete updateData._id;

    if (Array.isArray(updateData.questions)) {
      updateData.questions.forEach(q => {
        if (typeof q !== 'object' || !q.type || !q.question) {
          throw new Error('Incorrect question format');
        }
      });
    } else {
      throw new Error('Questions must be an array');
    }

    Object.assign(survey, updateData);
    await survey.save();
    res.json(survey);
  } catch (error) {
    console.error('Update error:', error);
    res.status(400).json({ 
      error: 'Error during update', 
      message: error.message, 
      details: error.errors 
    });
  }
});

app.delete('/api/surveys/:id', async (req, res) => {
  try {
    const result = await Survey.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Questionnaire not found' });
    }
    res.json({ success: true, message: 'The questionnaire has been successfully deleted' });
  } catch (error) {
    console.error('Error deleting profile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/responses', upload.array('images'), async (req, res) => {
  try {
    const { surveyId, answers, timeSpent } = req.body;
    const parsedAnswers = JSON.parse(answers);

    if (req.files && req.files.length > 0) {
      let fileIndex = 0;
      parsedAnswers.forEach(answer => {
        if (answer.answer && answer.answer.startsWith('image_') && req.files[fileIndex]) {
          answer.filePath = `/uploads/${req.files[fileIndex].filename}`;
          delete answer.answer;
          fileIndex++;
        }
      });
    }

    const response = new Response({ surveyId, answers: parsedAnswers, timeSpent });
    await response.save();
    await Survey.findByIdAndUpdate(surveyId, { $inc: { responseCount: 1 } });
    const stats = await getSurveyStats(surveyId);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error saving answer:', error);
    res.status(500).json({ error: 'Server error', message: error.message });
  }
});

app.get('/api/surveys/:id/stats', async (req, res) => {
  const surveyId = req.params.id;
  const responses = await Response.find({ surveyId });

  const avgTime = responses.length ? 
    responses.reduce((sum, r) => sum + r.timeSpent, 0) / responses.length : 0;

  const fillsByPeriod = {
    day: await Response.countDocuments({
      surveyId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }),
    week: await Response.countDocuments({
      surveyId,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }),
    month: await Response.countDocuments({
      surveyId,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    })
  };

  const questionStats = {};
  responses.forEach(r => {
    r.answers.forEach(a => {
      questionStats[a.question] = questionStats[a.question] || {};
      if (Array.isArray(a.answer)) {
        a.answer.forEach(ans => {
          questionStats[a.question][ans] = (questionStats[a.question][ans] || 0) + 1;
        });
      } else {
        questionStats[a.question][a.answer || a.filePath || ''] = 
          (questionStats[a.question][a.answer || a.filePath || ''] || 0) + 1;
      }
    });
  });

  res.json({ avgTime, fillsByPeriod, questionStats });
});


app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


portfinder.basePort = 3000;
portfinder.getPort((err, port) => {
  if (err) {
    console.error('Error searching for port:', err);
    return;
  }
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});


async function getSurveyStats(surveyId) {
  const responses = await Response.find({ surveyId });

  const avgTime = responses.length ? 
    responses.reduce((sum, r) => sum + r.timeSpent, 0) / responses.length : 0;

  const fillsByPeriod = {
    day: await Response.countDocuments({
      surveyId,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }),
    week: await Response.countDocuments({
      surveyId,
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }),
    month: await Response.countDocuments({
      surveyId,
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    })
  };

  const questionStats = {};
  responses.forEach(r => {
    r.answers.forEach(a => {
      questionStats[a.question] = questionStats[a.question] || {};
      if (Array.isArray(a.answer)) {
        a.answer.forEach(ans => {
          questionStats[a.question][ans] = (questionStats[a.question][ans] || 0) + 1;
        });
      } else {
        questionStats[a.question][a.answer || a.filePath || ''] = 
          (questionStats[a.question][a.answer || a.filePath || ''] || 0) + 1;
      }
    });
  });

  return { avgTime, fillsByPeriod, questionStats };
}