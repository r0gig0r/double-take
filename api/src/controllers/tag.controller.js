const fs = require('fs');
const sizeOf = require('probe-image-size');
const database = require('../util/db.util');
const { jwt } = require('../util/auth.util');
const { AUTH, STORAGE, UI } = require('../constants')();
const CONFIG = require('../constants/config');
const axios = require('axios');

const format = async (faces) => {
  const token = AUTH && faces.length ? jwt.sign({ route: 'storage' }) : null;

  faces = await Promise.all(
    faces.map(async (obj) => {
      const { id, filename, event, response, createdAt } = obj;
      const parsedEvent = JSON.parse(event);
      const parsedResponse = JSON.parse(response);
      const key = `matches/${filename}`;

      const { width, height } = await sizeOf(
        fs.createReadStream(`${STORAGE.MEDIA.PATH}/${key}`)
      ).catch(() => ({ width: 0, height: 0 }));

      // Extract face data from response
      const result = parsedResponse[0]?.results[0] || {};

      return {
        id,
        filename,
        camera: parsedEvent.camera,
        timestamp: createdAt,
        confidence: result.confidence || 0,
        box: result.box || {},
        file: {
          key,
          filename,
          width,
          height,
        },
        snapshot_url: `/api/storage/matches/${filename}`,
        token,
      };
    })
  );

  return faces;
};

module.exports.getUnknownFaces = async (req, res) => {
  const { limit = 50, offset = 0, camera, sort = 'date_desc' } = req.query;
  const db = database.connect();

  // Build WHERE clause
  let whereClause = `
    WHERE json_extract(response, '$[0].results[0].name') = 'unknown'
    AND json_extract(response, '$[0].results[0].match') = 0
  `;

  // Add camera filter if provided
  if (camera) {
    whereClause += ` AND json_extract(event, '$.camera') = '${camera}'`;
  }

  // Build ORDER BY clause
  let orderBy = 'ORDER BY createdAt DESC';
  if (sort === 'date_asc') {
    orderBy = 'ORDER BY createdAt ASC';
  } else if (sort === 'confidence_desc') {
    orderBy = `ORDER BY CAST(json_extract(response, '$[0].results[0].confidence') AS REAL) DESC`;
  }

  // Get total count
  const [totalResult] = db
    .prepare(`SELECT COUNT(*) as count FROM match ${whereClause}`)
    .all();

  // Get paginated results
  const faces = db
    .prepare(`
      SELECT
        id,
        filename,
        event,
        response,
        createdAt
      FROM match
      ${whereClause}
      ${orderBy}
      LIMIT ? OFFSET ?
    `)
    .all(parseInt(limit), parseInt(offset));

  const formattedFaces = await format(faces);

  res.send({
    total: totalResult.count,
    limit: parseInt(limit),
    offset: parseInt(offset),
    faces: formattedFaces,
  });
};

module.exports.tagFace = async (req, res) => {
  const { filename, subject, image_id } = req.body;

  if (!filename || !subject) {
    return res.status(400).send({ error: 'filename and subject are required' });
  }

  const db = database.connect();

  // Record the tagging in the file table to track tagged faces
  try {
    db.prepare(
      `INSERT OR IGNORE INTO file (name, filename, meta, isActive, createdAt)
       VALUES (?, ?, ?, 1, datetime('now'))`
    ).run(subject, filename, JSON.stringify({ image_id, tagged: true }));

    // Get count of training images for this subject
    const [countResult] = db
      .prepare(`SELECT COUNT(*) as count FROM file WHERE name = ? AND isActive = 1`)
      .all(subject);

    res.send({
      success: true,
      subject,
      training_count: countResult.count,
    });
  } catch (error) {
    console.error('Error recording tag:', error);
    res.status(500).send({ error: 'Failed to record tag' });
  }
};

module.exports.getSubjects = async (req, res) => {
  try {
    const compreFaceConfig = CONFIG.detectors().find((d) => d.type === 'compreface');

    if (!compreFaceConfig) {
      return res.status(400).send({ error: 'CompreFace not configured' });
    }

    // Fetch subjects from CompreFace
    const response = await axios.get(
      `${compreFaceConfig.url}/api/v1/recognition/subjects`,
      {
        headers: {
          'x-api-key': compreFaceConfig.key,
        },
        timeout: compreFaceConfig.timeout * 1000 || 15000,
      }
    );

    const subjects = response.data.subjects || [];

    // Get face count for each subject
    const subjectsWithCounts = await Promise.all(
      subjects.map(async (subjectName) => {
        try {
          const facesResponse = await axios.get(
            `${compreFaceConfig.url}/api/v1/recognition/faces?subject=${encodeURIComponent(subjectName)}`,
            {
              headers: {
                'x-api-key': compreFaceConfig.key,
              },
              timeout: compreFaceConfig.timeout * 1000 || 15000,
            }
          );

          return {
            name: subjectName,
            image_count: facesResponse.data.total_elements || 0,
            last_trained: null, // CompreFace API doesn't provide this
          };
        } catch (error) {
          console.error(`Error fetching face count for ${subjectName}:`, error.message);
          return {
            name: subjectName,
            image_count: 0,
            last_trained: null,
          };
        }
      })
    );

    res.send({ subjects: subjectsWithCounts });
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).send({ error: 'Failed to fetch subjects from CompreFace' });
  }
};

module.exports.getCameras = async (req, res) => {
  const db = database.connect();

  try {
    const cameras = db
      .prepare(`
        SELECT DISTINCT json_extract(event, '$.camera') as name
        FROM match
        WHERE json_extract(response, '$[0].results[0].name') = 'unknown'
        ORDER BY name ASC
      `)
      .all()
      .map((obj) => obj.name);

    res.send({ cameras });
  } catch (error) {
    console.error('Error fetching cameras:', error);
    res.status(500).send({ error: 'Failed to fetch cameras' });
  }
};

module.exports.getStats = async (req, res) => {
  const db = database.connect();

  try {
    // Total unknown faces
    const [unknownCount] = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM match
        WHERE json_extract(response, '$[0].results[0].name') = 'unknown'
        AND json_extract(response, '$[0].results[0].match') = 0
      `)
      .all();

    // Total trained subjects (from file table)
    const [subjectCount] = db
      .prepare(`SELECT COUNT(DISTINCT name) as count FROM file WHERE isActive = 1`)
      .all();

    // Faces tagged today (based on file table createdAt)
    const [taggedToday] = db
      .prepare(`
        SELECT COUNT(*) as count
        FROM file
        WHERE date(createdAt) = date('now')
        AND isActive = 1
      `)
      .all();

    res.send({
      unknown_faces: unknownCount.count,
      trained_subjects: subjectCount.count,
      tagged_today: taggedToday.count,
      success_rate: 100, // This would need more sophisticated tracking
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).send({ error: 'Failed to fetch statistics' });
  }
};
