const { core } = require('@example/core');

module.exports.billingService = function billingService() {
  return `billing-service using ${core()}`;
};
