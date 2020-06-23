// eslint-disable-next-line new-cap
const router = require('express').Router();
const { redis, keys, scraper } = require('./instances');
const { splitQuery } = require('../utils/stringUtils');

router.get('/historical', async (req, res) => {
	const { lastdays } = req.query;
	const allDataByCountry = scraper.historical.getHistoricalDataV2(
		JSON.parse(await redis.get(keys.historical_v2)),
		lastdays
	);
	res.send(allDataByCountry);
});


router.get('/historical/all', async (req, res) => {
	const { lastdays } = req.query;
	res.send(await scraper.historical.getHistoricalAllDataV2(JSON.parse(await redis.get(keys.historical_v2)), lastdays));
});

router.get('/historical/:query/:province?', async (req, res) => {
	const data = JSON.parse(await redis.get(keys.historical_v2));
	const { query, province } = req.params;
	const { lastdays } = req.query;
	const countries = splitQuery(query);
	const provinces = (province && splitQuery(province)) || [];
	let countryData;
	// multiple countries no provinces allowed
	if (countries.length > 1) {
		countryData = countries.map((country) =>
			scraper.historical.getHistoricalCountryDataV2(
				data,
				country,
				null,
				lastdays
			) || { message: 'Country not found or doesn\'t have any historical data' }
		);
	} else if (provinces.length > 0) {
		// provinces for one country
		countryData = provinces.map((prov) =>
			scraper.historical.getHistoricalCountryDataV2(
				data,
				countries[0],
				prov.trim(),
				lastdays
			) || { message: 'Country not found or doesn\'t have any historical data' }
		);
	} else {
		countryData = scraper.historical.getHistoricalCountryDataV2(
			data,
			query,
			province,
			lastdays
		);
	}
	if (countryData) {
		res.send(countryData.length === 1 ? countryData[0] : countryData);
	} else {
		res.status(404).send({ message: 'Country not found or doesn\'t have any historical data' });
	}
});

module.exports = router;
