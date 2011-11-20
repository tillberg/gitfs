
var events = require('events');
var _ = require('underscore')._;
_.mixin(require('underscore.string')._);
//var fs = require('fs-ext');
var async = require('async');
var Tree = require('./tree').Tree;

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

Repo._revParse = function(rev, cb) {
  var self = this;
  self.clone(function() {
    self.gitExec(['rev-parse', rev], function(err, data) {
      cb(err, _.trim(data));
    });
  });
};

Repo.branch = Repo.tree = function(name, cb) {
  if (cb) {
    var self = this;
    self._revParse(name, function(err, sha1) {
      cb(err, Tree.make(self, sha1));
    });
  } else {
    // How would or should we lookup branch names and such?
    return Tree.make(this, name);
  }
};

Repo.readFile = function (path, cb) {
  // readFile on the Repo directly assumes that you're interested
  // in the master branch.
  var self = this;
  self.tree('master', function(err, tree) {
    tree.readFile(path, cb);
  });
};

Repo.checkout = function(path, cb) {
  // Like readFile, assume master
  var self = this;
  self.tree('master', function(err, tree) {
    tree.checkout(path, cb);
  });
};

Repo._readBlob = function(sha1, cb) {
  this.gitExec(['cat-file', '-p', sha1], cb);
};

Repo.gitExec = function (args, cb) {
  var self = this;
  this.clone(function() {
    exec('git', args, { cwd: self.basePath }, function() {
      // Centralized logging/management?
      cb.apply(this, arguments);
    });
  });
};

exports.Repo = Repo;

