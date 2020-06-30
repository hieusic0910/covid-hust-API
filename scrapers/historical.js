const axios = require('axios');
const countryUtils = require('../utils/countryUtils');
const stringUtils = require('../utils/stringUtils');
const csvUtils = require('../utils/csvUtils');
const logger = require('../utils/logger');

// eslint-disable-next-line max-len
const base = 'https://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_time_series/';

/**
 * Formats recovered data from JHU to match cases data in length and format
 * @param 	{array}		cases 		JSON formatted cases data from JHU csv file
 * @param 	{array} 	recovered 	JSON formatted recovered data from JHU csv file
 * @returns {array} 				JSON formatted recovered data in same structure as cases data
 */
function formatRecoveredData(cases, recovered) {
	const dates = Object.keys(cases[0]).slice(4);
	const countries = cases.map((country) => ({
		name: country['Country/Region'],
		province: country['Province/State'] || '',
		Lat: country.Lat || '',
		Long: country.Long || ''
	}));
	return countries.map((country) => {
		const provinces = recovered.filter(el => el['Country/Region'] === country.name && el['Province/State'] === country.province);
		dates.forEach(date => {
			country[date] = provinces[0] ? parseInt(provinces[0][date]) : 0;
		});
		return country;
	});
}

/**
 * Fills redis with JHU csv country timeline data
 * @param 	{string}	keys 	config countries key
 * @param 	{Object}	redis 	Redis db
 */
const historical = async (keys, redis) => {
	const timelineIndex = 4;
	let casesResponse, deathsResponse, recoveredResponse;
	try {
		casesResponse = await axios.get(`${base}time_series_covid19_confirmed_global.csv`);
		deathsResponse = await axios.get(`${base}time_series_covid19_deaths_global.csv`);
		recoveredResponse = await axios.get(`${base}time_series_covid19_recovered_global.csv`);
	} catch (err) {
		logger.err(err, 'error in Global JHUhistorical REQUEST');
		return;
	}
	const parsedCases = await csvUtils.parseCsvData(casesResponse.data);
	const parsedDeaths = await csvUtils.parseCsvData(deathsResponse.data);
	const parsedRecovered = await csvUtils.parseCsvData(recoveredResponse.data);
	// JHU Data is very poorly formatted, but we fix it :)
	const formatedRecovered = formatRecoveredData(parsedCases, parsedRecovered);
	// dates key for timeline
	const timelineKey = Object.keys(parsedCases[0]).splice(timelineIndex);
	// format csv data to response
	const result = parsedCases.map((_, index) => {
		const newElement = {
			country: '', countryInfo: {}, province: null, timeline: { cases: {}, deaths: {}, recovered: {} }
		};
		const cases = Object.values(parsedCases[index]).splice(timelineIndex);
		const deaths = Object.values(parsedDeaths[index]).splice(timelineIndex);
		const recovered = Object.values(formatedRecovered[index]).splice(timelineIndex);

		for (let i = 0; i < cases.length; i++) {
			newElement.timeline.cases[timelineKey[i]] = parseInt(cases[i]);
			newElement.timeline.deaths[timelineKey[i]] = parseInt(deaths[i]);
			newElement.timeline.recovered[timelineKey[i]] = parseInt(recovered[i] || 0);
		}

		// add country info to support iso2/3 queries
		const parsedAtIndex = Object.values(parsedCases)[index];
		const countryData = countryUtils.getCountryData(parsedAtIndex['Country/Region'].replace('*', ''));
		newElement.country = countryData.country || parsedAtIndex['Country/Region'];
		newElement.countryInfo = countryData;
		newElement.province = parsedAtIndex['Province/State'] === '' ? null
			: parsedAtIndex['Province/State'].toLowerCase();
		return newElement;
	});

	redis.set(keys.historical_v2, JSON.stringify(result));
	logger.info(`Updated JHU CSSE Historical: ${result.length} locations`);
};

/**
 * Parses data from historical endpoint and returns data for each country & province
 * @param 	{array}		data		Full historical data returned from /historical endpoint
 * @param 	{string}	lastdays  	How many days to show always take lastest
 * @returns {Object}				The filtered historical data.
 */
const getHistoricalData = (data, lastdays = 30) => {
	lastdays = stringUtils.getLastDays(lastdays);
	return data.map(country => {
		delete country.countryInfo;
		const cases = {}, deaths = {}, recovered = {};
		Object.keys(country.timeline.cases).slice(lastdays * -1).forEach(key => {
			cases[key] = country.timeline.cases[key];
			deaths[key] = country.timeline.deaths[key];
			recovered[key] = country.timeline.recovered[key];
			return true;
		});
		country.timeline = { cases, deaths, recovered };
		return country;
	});
};

/**
 * Parses data from historical endpoint and returns data for specific country || province
 * @param 	{array}		data		Full historical data returned from /historical endpoint
 * @param 	{string}	query   	Country query param
 * @param 	{string}	province  	Province query param (optional)
 * @param 	{string}	lastdays  	How many days to show always take lastest
 * @returns {Object}				The filtered historical data.
 */
const getHistoricalCountryData = (data, query, province = null, lastdays = 30) => {
	lastdays = stringUtils.getLastDays(lastdays);
	const countryInfo = countryUtils.getCountryData(query);
	const standardizedCountryName = stringUtils.wordsStandardize(countryInfo.country ? countryInfo.country : query);
	// filter to either specific province, or provinces to sum country over
	const countryData = data.filter(item => {
		const deepMatch = () => stringUtils.wordsStandardize(item.country) === standardizedCountryName
			&& item.countryInfo.iso2 === countryInfo.iso2
			&& item.countryInfo.iso3 === countryInfo.iso3
			&& item.countryInfo._id === countryInfo._id;
		if (item.countryInfo.country) {
			if (province) {
				return (item.province === province.toLowerCase() || (item.province === null && province.toLowerCase() === 'mainland'))
					&& deepMatch();
			}
			return deepMatch();
		}
		return stringUtils.wordsStandardize(item.country) === standardizedCountryName;
	});
	if (countryData.length === 0) return null;

	// overall timeline for country
	const timeline = { cases: {}, deaths: {}, recovered: {} };
	const provinces = [];
	countryData.forEach((_, index) => {
		countryData[index].province ? provinces.push(countryData[index].province) : provinces.push('mainland');
		// loop cases, deaths for each province
		Object.keys(countryData[index].timeline).forEach((specifier) => {
			Object.keys(countryData[index].timeline[specifier]).slice(lastdays * -1).forEach((date) => {
				// eslint-disable-next-line no-unused-expressions
				timeline[specifier][date] ? timeline[specifier][date] += parseInt(countryData[index].timeline[specifier][date])
					: timeline[specifier][date] = parseInt(countryData[index].timeline[specifier][date]);
			});
		});
	});
	return {
		country: countryData[0].country || standardizedCountryName,
		province: province ? countryData[0].province || province : provinces,
		timeline
	};
};

/**
 * Parses data from historical endpoint and returns summed global statistics
 * @param 	{array} 	data 		Full historical data returned from /historical endpoint
 * @param	{string}	lastdays  	How many days to show always take lastest
 * @returns {Object}				The global deaths and cases
 */
const getHistoricalAllData = (data, lastdays = 30) => {
	lastdays = stringUtils.getLastDays(lastdays);
	const cases = {};
	const deaths = {};
	const recovered = {};
	data.forEach(country => {
		Object.keys(country.timeline.cases).slice(lastdays * -1).forEach(key => {
			/* eslint no-unused-expressions: ["error", { "allowTernary": true }] */
			cases[key] ? cases[key] += country.timeline.cases[key] : cases[key] = country.timeline.cases[key];
			deaths[key] ? deaths[key] += country.timeline.deaths[key] : deaths[key] = country.timeline.deaths[key];
			recovered[key] ? recovered[key] += country.timeline.recovered[key] : recovered[key] = country.timeline.recovered[key];
			return true;
		});
		return true;
	});
	return {
		cases,
		deaths,
		recovered
	};
};


module.exports = {
	historical,
	getHistoricalData,
	getHistoricalCountryData,
	getHistoricalAllData

};
