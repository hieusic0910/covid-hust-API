const express = require('express');

const app = express();
const Sentry = require('@sentry/node');

const csrfProtection = require('csurf')({ cookie: true });

const logger = require('./utils/logger');
const path = require('path');
const { config, port, redis, scraper, keys } = require('./routes/instances');


if (config.sentry_key) Sentry.init({ dsn: config.sentry_key });


app.use(require('cors')({ origin: '*' }));
app.use(express.static(path.join(__dirname, '/public')));


app.set('views', path.join(__dirname, '/public'));
app.set('view engine', 'ejs');
app.use(require('cookie-parser')());

app.get('/', csrfProtection, async (req, res) => res.render('index', {
	csrfToken: req.csrfToken(),
	chartData: await scraper.historical.getHistoricalAllDataV2(JSON.parse(await redis.get(keys.historical_v2)), 'all')
}));

app.use((req, res, next) => {
	if (process.env.TEST_MODE) {
		logger.info(`Status: ${res.statusCode}\t\t URL: ${res.req.path}`);
	}
	next();
});
app.use(require('./routes/apiWorldometers'));
app.use(require('./routes/apiHistorical'));
app.use(require('./routes/apiJHUCSSE'));

app.listen(port, () => logger.info(`Your app is listening on port ${port}`));

module.exports = app;