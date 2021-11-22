#!/usr/bin/env node
'use strict';

var forever = require('forever-monitor');
var path = require('path');

var restartCount = 0;
var sqsdProcess = new (forever.Monitor)(path.join(__dirname, 'cli.js'), {
    fork: true,
    max: 1000,
    minUptime: 22000,
    args: process.argv.slice(2)
});

sqsdProcess.on('error', function (err) {
    console.error( {err:err}, 'Error caused SQSD to crash.');



});

sqsdProcess.on('restart', function () {
    console.warn({restartCount:restartCount}, 'It is likely that an error caused SQSD to crash.');
    ++restartCount;

});

sqsdProcess.on('exit', function () {
    console.info('SQSD stopped.');
});

sqsdProcess.start();

process.on('SIGTERM', () => {
  console.info('SIGTERM signal received, graceful shutdown sqsd');
  sqsdProcess.forceStop = true;
  sqsdProcess.send({action: 'shutdown'});
});
