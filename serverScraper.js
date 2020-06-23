const { scraper: { executeScraper }, config } = require('./routes/instances');

executeScraper();

// Update Worldometer and Johns Hopkins data every 10 minutes
setInterval(executeScraper, config.interval);
// Update Government data every  24 hours

