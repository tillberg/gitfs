require('tillberg_common');
var Repo = require('./repo').Repo;

var Git = proto();
Git.init = function(rootPath) {
  this.rootPath = rootPath;
};

Git.ready = function(cb) {
  if (!this.rootPath.match(/^\w+$/)) {
    console.error('You probably don\'t mean to set rootPath to that.');
    process.exit(1);
  }
  var self = this;
  exec('rm', ['-rf', this.rootPath], { cwd: './' }, function() {
    exec('mkdir', [self.rootPath], { cwd: './' }, function() {
      cb(null, self);
    });
  });
};

Git.getRepo = function(url) {
  return Repo.make(this, url);
};

exports.Git = Git;
