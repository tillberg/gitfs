
var events = require('events');
var _ = require('underscore')._;

var Repo = proto();
Repo.init = function(git, url) {
  this.git = git;
  this.url = url;
  this.ev = new events.EventEmitter();
};

_.each('once,on,emit'.split(','), function(v) {
  Repo[v] = function() {
    ev[v].apply(ev[v], arguments);
  };
});

Repo.getBranches = function(cb) {
  
};

exports.Repo = Repo;

