// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const portfinder = require('portfinder');
const multer = require('multer');

const app = express();

// Настройка multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB
});

app.use(express.json()); // Парсинг JSON
app.use(express.static('public')); // Статические файлы
app.use('/uploads', express.static('uploads')); // Доступ к загруженным файлам

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log(err));

const Survey = require('./models/Survey');
const Response = require('./models/Response');

// Маршруты API
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
    res.status(400).json({ 
      error: 'Ошибка валидации', 
      message: error.message, 
      details: error.errors 
    });
  }
});

app.put('/api/surveys/:id', async (req, res) => {
  console.log('Updating survey with ID:', req.params.id);
  console.log('Received data:', req.body);
  try {
    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      console.log('Survey not found for ID:', req.params.id);
      return res.status(404).json({ error: 'Анкета не найдена' });
    }
    const updateData = { ...req.body };
    delete updateData._id;

    if (Array.isArray(updateData.questions)) {
      updateData.questions.forEach(q => {
        if (typeof q !== 'object' || !q.type || !q.question) {
          throw new Error('Некорректный формат вопроса');
        }
      });
    } else {
      throw new Error('Questions должен быть массивом');
    }

    Object.assign(survey, updateData);
    await survey.save();
    res.json(survey);
  } catch (error) {
    console.error('Update error:', error);
    res.status(400).json({ 
      error: 'Ошибка при обновлении', 
      message: error.message, 
      details: error.errors 
    });
  }
});

app.delete('/api/surveys/:id', async (req, res) => {
  try {
    const result = await Survey.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Анкета не найдена' });
    }
    res.json({ success: true, message: 'Анкета успешно удалена' });
  } catch (error) {
    console.error('Ошибка удаления анкеты:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/responses', upload.array('images'), async (req, res) => {
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

  try {
    const response = new Response({ surveyId, answers: parsedAnswers, timeSpent });
    await response.save();
    await Survey.findByIdAndUpdate(surveyId, { $inc: { responseCount: 1 } });
    const stats = await getSurveyStats(surveyId);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Ошибка сохранения ответа:', error);
    res.status(500).json({ error: 'Ошибка сервера', message: error.message });
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

// Обработчик всех остальных маршрутов (после API)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
portfinder.basePort = 3000;
portfinder.getPort((err, port) => {
  if (err) {
    console.error('Ошибка при поиске порта:', err);
    return;
  }
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});

// Функция для получения статистики
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