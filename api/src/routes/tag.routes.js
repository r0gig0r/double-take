const express = require('express');
const { jwt, validate, Joi } = require('../middlewares');
const controller = require('../controllers/tag.controller');

const router = express.Router();

router.get(
  '/unknown-faces',
  jwt,
  validate({
    query: {
      limit: Joi.number().integer().default(50).min(1),
      offset: Joi.number().integer().default(0).min(0),
      camera: Joi.string().optional(),
      sort: Joi.string().valid('date_desc', 'date_asc', 'confidence_desc').default('date_desc'),
    },
  }),
  controller.getUnknownFaces
);

router.post(
  '/tag-face',
  jwt,
  validate({
    body: {
      filename: Joi.string().required(),
      subject: Joi.string().required(),
      image_id: Joi.string().optional(),
    },
  }),
  controller.tagFace
);

router.get('/subjects', jwt, controller.getSubjects);

router.get('/cameras', jwt, controller.getCameras);

router.get('/stats', jwt, controller.getStats);

module.exports = router;
