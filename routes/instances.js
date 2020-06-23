// NODE PACKAGES
const Redis = require('ioredis');

// LOCAL FUNCTIONS
const logger = require('../utils/logger');
const getWorldometerPage = require('../scrapers/getWorldometers');

const jhuLocations = require('../scrapers/jhuLocations');
const historical = require('../scrapers/historical');

// KEYS
const { config, keys, port } = require('../config');

const redis = new Redis(config.redis.host, {
	password: config.redis.password,
	port: config.redis.port
});

module.exports = {
	redis,
	port,
	keys,
	config,
	scraper: {
		getWorldometerPage,
		jhuLocations,
		historical,
		executeScraper: async () => {
			await Promise.all([
				getWorldometerPage(keys, redis),
				jhuLocations.jhudataV2(keys, redis),
				historical.historicalV2(keys, redis)
			]);
			logger.info('Finished scraping!');
		}
	}
};
