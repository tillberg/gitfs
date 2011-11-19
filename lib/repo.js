
var events = require('events');
var _ = require('underscore')._;
_.mixin(require('underscore.string')._);
var fs = require('fs-ext');
var async = require('async');

var Repo = proto();
Repo.init = function (git, basePath, url) {
  this.basePath = basePath;
  this.git = git;
  this.url = url;
  //this.ev = new events.EventEmitter();
  this.clone = async.memoize(cloneGen(this));
};

//_.each('once,on,emit'.split(','), function (v) {
//  Repo[v] = function() {
//    ev[v].apply(ev[v], arguments);
//  };
//});

function cloneGen (self) {
  return function (cb) {
    self.git.ready(function() {
      exec('git', ['clone', '--mirror', self.url, self.basePath], { cwd: './' }, function() {
        cb();
      });
    });
  };
}

Repo.getBranches = function (cb) {
  var self = this;
  this.clone(function () {
    self.gitExec(['branch'], function(err, data) {
      cb(_.map(_.trim(data).replace('*', '').split('\n'), function(line) { return _.trim(line); }));
    });
  });
};

Repo.readFile = function (path, cb) {
  
};

Repo.gitExec = function (args, cb) {
  exec('git', args, { cwd: this.basePath }, function() {
    cb.apply(this, arguments);
  });
};

exports.Repo = Repo;

