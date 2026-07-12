const { core } = require('../core');

module.exports.billingService = function billingService() {
  return `billing-service using ${core()}`;
};
