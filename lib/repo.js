
var events = require('events');
var _ = require('underscore')._;
_.mixin(require('underscore.string')._);
var fs = require('fs-ext');
var async = require('async');
var Tree = require('./tree').Tree;
var path = require('path');
var nimble = require('nimble');

var rgxSha1 = /^[0-9a-f]{40}$/;
function isSha1(s) {
  return !!(s + '').match(rgxSha1);
}

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

global.withLock = function(pathToLock, action, cb) {
  var fullPath = pathToLock + '.lock';
  fs.open(fullPath, 'a+', errorHandler('Failed to open lock file ' + fullPath, cb, function(err, fd) {
    fs.flock(fd, 'ex', errorHandler('Failed to acquire lock ' + fullPath, cb, function() {
      // Lock acquired
      action(function(err) {
        var that = this;
        var args = arguments;
        fs.flock(fd, 'un', errorHandler('Failed to release lock ' + fullPath, cb, function() {
          // Lock released
          fs.close(fd, errorHandler('Failed to close lock file ' + fullPath, cb, function() {
            cb.apply(that, args);
          }));
        }));
      });
    }));
  }));
};

function cloneGen (self) {
  return function (cb) {
    self.git.ready(function() {
      self.withLock(function(done) {
        path.exists(self.basePath, function(exists) {
          if (!exists) {
            fs.mkdir(self.basePath, function() {
              //error('Cloning ' + self.url);
              var handler = errorHandler('Error cloning ' + self.url + ' to ' + self.basePath, done, done);
              exec('git', ['clone', '--mirror', self.url, self.basePath], { cwd: './', quietError: true }, handler);
            });
          } else {
            // Someone else should/must have already cloned this.
            done();
          }
        });
      }, cb);
    });
  };
}

Repo.withLock = function(cb, cbDone) {
  withLock(this.basePath, cb, cbDone);
};

Repo.getBranches = function (cb) {
  var self = this;
  this.clone(errorHandler(cb, function () {
    self.gitExec(['branch', '-v', '--no-abbrev'], errorHandler(cb, function(err, data) {
      var branches = {};
      _.each(_.initial(data.split('\n')), function(line) {
        var match = (/^[* ]\s(\w+)\s+([0-9a-f]{40})\s/g).exec(line);
        if (match) {
          branches[match[1]] = match[2];
        }
      });
      cb(err, branches);
    }));
  }));
};

Repo.getAllRevs = function(cb) {
  var self = this;
  self.clone(errorHandler(cb, function () {
    self.gitExec(['rev-list', '--all'], errorHandler(cb, function(err, data) {
      cb(null, _.initial(data.split('\n')));
    }));
  }));
};

Repo._revParse = function(rev, cb) {
  var self = this;
  self.clone(errorHandler(cb, function() {
    self.gitExec(['rev-parse', rev], errorHandler(cb, function(err, data) {
      cb(null, _.trim(data));
    }));
  }));
};

Repo.branch = Repo.tree = function(name, cb) {
  if (cb) {
    if (name.match(rgxSha1)) {
      cb(null, Tree.make(this, name));
    } else {
      var self = this;
      self._revParse(name, errorHandler(cb, function(err, sha1) {
        cb(null, Tree.make(self, sha1));
      }));
    }
  } else {
    // How would or should we lookup branch names and such?
    return Tree.make(this, name);
  }
};

Repo.readFile = function (filePath, cb) {
  // readFile on the Repo directly assumes that you're interested
  // in the master branch.
  var self = this;
  self.tree('master', errorHandler(cb, function(err, tree) {
    tree.readFile(filePath, cb);
  }));
};

Repo.lsAll = function (cb) {
  var self = this;
  self.tree('master', errorHandler(cb, function(err, tree) {
    tree.lsAll(errorHandler(cb, cb));
  }));
};

Repo.checkout = function(checkoutPath, cb) {
  // Like readFile, assume master
  var self = this;
  self.tree('master', errorHandler(cb, function(err, tree) {
    tree.checkout(checkoutPath, errorHandler(cb, cb));
  }));
};

Repo._lsTree = function(sha1, cb, noUpdate) {
  var self = this;
  self.gitExec(['ls-tree', sha1], function(err, data) {
    if (noUpdate || !err) {
      cb(err, data);
    } else {
      self.update(errorHandler(cb, function() {
        self._lsTree(sha1, cb, true);
      }));
    }
  });
};

Repo.update = function(cb) {
  var self = this;
  //error('Updating ' + self.url);
  self.withLock(function(done) {
    self.gitExec(['remote', 'update'], done);
  }, cb);
};

Repo.diffTree = function(tree1, tree2, cb) {
  if (isSha1(tree1)) { tree1 = Tree.make(this, tree1); }
  if (isSha1(tree2)) { tree2 = Tree.make(this, tree2); }
  async.map([ tree1, tree2 ], function(tree, done) {
    tree.lsAll(errorHandler(done, function(err, files, blobs) {
      done(null, { byPath: files, bySha1 : blobs });
    }));
  }, errorHandler(cb, function(err, lists) {
    var changes = [];
    var ls1 = lists[0];
    var ls2 = lists[1];
    var deletedPaths = _.extend(ls1.byPath);
    // TODO: catch deleted files
    _.each(ls2.bySha1, function(path, sha1) {
      if (ls1.bySha1[sha1]) {
        if (ls1.bySha1[sha1] === path) {
          // no change
          delete deletedPaths[path];
        } else {
          // renamed; blob the same, though
          // note that we're not catching renames that are mostly the same... they're just counting as delete & add
          changes.push({ type: 'rename', before: { path: ls1.bySha1[sha1], sha1: sha1 }, after: { path: path, sha1: sha1 } });
          delete deletedPaths[ls1.bySha1[sha1]];
        }
      } else {
        if (ls1.byPath[path]) {
          // changed
          changes.push({ type: 'change', before: { path: path, sha1: ls1.byPath[path] }, after: { path: path, sha1: sha1 } });
          delete deletedPaths[path];
        } else {
          // added
          changes.push({ type: 'add', before: { }, after: { path: path, sha1: sha1 } });
        }
      }
    });
    _.each(_.keys(deletedPaths), function(path) {
      changes.push({ type: 'delete', before: { path: path, sha1: ls1.byPath[path] }, after: { } });
    });
    cb(null, changes);
  }));
};

Repo._readBlob = function(sha1, cb) {
  this.gitExec(['cat-file', '-p', sha1], cb);
};

Repo.gitExec = function (args, opts, cb) {
  if (!cb) { cb = opts; opts = {}; }
  var self = this;
  this.clone(function() {
    //error('git ' + args.join(' ') + ' @ ' + path.resolve(self.basePath));
    var proc = exec('git', args, { cwd: self.basePath, quietError: true }, errorHandler('Error on git-' + args[0] + ': ERR, ARG0 ARG1', cb, function(err, stdout, stderr) {
      cb((err ? stderr || err : null), stdout);
    }));
    if (opts.data) { proc.stdin.end(opts.data); }
  });
};

exports.Repo = Repo;

