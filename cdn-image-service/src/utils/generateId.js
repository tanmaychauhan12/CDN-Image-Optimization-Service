const { v4: uuidv4 } = require('uuid');

/**
 * Generates a unique v4 UUID string.
 * @returns {string} Unique UUID
 */
const generateId = () => {
  return uuidv4();
};

module.exports = generateId;
