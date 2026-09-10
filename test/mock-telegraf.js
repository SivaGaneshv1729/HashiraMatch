const Module = require('module');

const originalLoad = Module._load;

function TelegrafMock(token) {
  this.token = token;
  this.useHandlers = [];
  this.startHandler = null;
  this.onHandlers = {};
  this.launchCalls = 0;
  this.stopCalls = [];
  this.telegram = {};
}

TelegrafMock.prototype.use = function (fn) {
  this.useHandlers.push(fn);
  return this;
};
TelegrafMock.prototype.start = function (fn) {
  this.startHandler = fn;
  return this;
};
TelegrafMock.prototype.on = function (event, fn) {
  this.onHandlers[event] = fn;
  return this;
};
TelegrafMock.prototype.launch = function () {
  this.launchCalls += 1;
  return this;
};
TelegrafMock.prototype.stop = function (reason) {
  this.stopCalls.push(reason);
  return this;
};

const instances = [];

function fakeTelegrafConstructor() {
  const inst = new TelegrafMock(...arguments);
  instances.push(inst);
  return inst;
}

function installTelegrafMock() {
  Module._load = function (request, parent, isMain) {
    if (request === 'telegraf') {
      return { Telegraf: fakeTelegrafConstructor };
    }
    return originalLoad.apply(this, arguments);
  };
}

function restore() {
  Module._load = originalLoad;
}

module.exports = {
  installTelegrafMock,
  restore,
  getInstances: () => instances,
  resetInstances: () => { instances.length = 0; },
  _constructor: fakeTelegrafConstructor
};
