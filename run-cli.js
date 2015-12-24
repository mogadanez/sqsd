#!/usr/bin/env node
'use strict';

var forever = require('forever-monitor');
var logger = require('./lib/logger');
var path = require('path');

var pkg = require('./package.json');

var restartCount = 0;
var sqsdProcess = new (forever.Monitor)(path.join(__dirname, 'cli.js'), {
    max: 1000,
    minUptime: 10000,
    args: process.argv.slice(2)
});

sqsdProcess.on('error', function (err) {
    logger.error( {err:err}, 'Error caused SQSD to crash.');



});

sqsdProcess.on('restart', function () {
    logger.warn({restartCount:restartCount}, 'It is likely that an error caused SQSD to crash.');
    ++restartCount;

});

sqsdProcess.on('exit', function () {
    logger.info('SQSD stopped.');
});

sqsdProcess.start();
