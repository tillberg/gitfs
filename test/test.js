require('tillberg_common');
var fs = require('fs');
var vows = require('vows');
var assert = require('assert');
var _ = require('underscore');
var crypto = require('crypto');
var async = require('async');
var nimble = require('nimble');
var path = require('path');

var gitfs = require('../lib/gitfs');
var Repo = require('../lib/repo').Repo;

var cleanUpPrevious = async.memoize(function (cb) {
  // This cleans out previous test runs
  exec('rm', ['-rf', 'var/'], { cwd: './' }, function() {
    cb();
  });
});

var rgxSha1 = /^[0-9a-f]{40}$/;

function getGit(index, cb) {
  cleanUpPrevious(function() {
    if (index === null) {
      cb(gitfs);
    } else {
      cb(gitfs.workspace('var/t' + index));
    }
  });
}

var gitfsTests = vows.describe('gitfs Object');

function ctxGit(index) {
  return function() {
    var cb = this.callback;
    getGit(index, function(git) {
      cb(null, git);
    });
  };
}
function time() { return (new Date()).getTime(); }

gitfsTests.addBatch({
  'When we load up Git': {
    topic: ctxGit(0),
    'we should get a Git object': function(git) {
      assert.isFunction(git.repo);
    },
    'and get another Git with the same index': {
      topic: ctxGit(0),
      'they are the same object': function(git) {
        assert.equal(git, this.context.topics[1]);
      }
    }
  },
  'We can also just get the default Git': {
    topic: ctxGit(null),
    'and its rootPath should be `gitfs-var/`': function(git) {
      assert.ok(git);
      assert.equal(git.rootPath, 'gitfs-var/');
    },
    'and if we load up the 0-index Git': {
      topic: ctxGit(0),
      'it should be a different object': function(git) {
        assert.notEqual(git, this.context.topics[1]);
      }
    }
  }
});
gitfsTests.export(module);

var commands = {
  'list branches': function(repo, cb) {
    repo.getBranches(cb);
  },
  'get Repo': function(repo, cb) {
    cb(null, repo);
  },
  'get master': function(repo, cb) {
    repo.branch('master', function(err, tree) {
      cb(null, tree);
    });
  }
};

var repoIndex = 1;
function createRepo(cb) {
  var myPath = 'var/testrepo' + (repoIndex++);
  exec('mkdir', ['-p', myPath], { cwd: './' }, function() {
    exec('git', ['init'], { cwd: myPath }, function() {
      cb(myPath);
    });
  });
}

function initRepo(myPath, type, cb) {
  fs.writeFile(path.join(myPath, 'README'), 'hello' + type + '\n', function(err) {
    exec('git', ['add', 'README'], { cwd: myPath }, function(err) {
      exec('git', ['commit', '-m', 'Initial commit.'], { cwd: myPath }, function(err) {
        cb();
      });
    });
  });
}

function ctxLoad(gitIndex) {
  gitIndex = gitIndex || 999;
  return function() {
    var callback = this.callback;
    var match = this.context.name.match(/we (.+) of (.+)$/);
    if (!match) { return callback('Test error, could not parse ' + this.context.name); }
    var urlish = match[2];
    var command = match[1];
    if (!commands[command]) { return callback('Test error, could not find parsed command: ' + command); }
    var self = this;
    function run(url) {
      getGit(gitIndex, function(git) {
        var repo = git.repo(url);
        commands[command](repo, callback);
      });
    }
    if (urlish.match(/a new/)) {
      createRepo(function(newUrl) {
        if (urlish.match(/empty/)) {
          run(newUrl);
        } else {
          var type = urlish.match(/repo-(\w+)$/)[1];
          initRepo(newUrl, type, function() {
            run(newUrl);
          });
        }
      });
    } else {
      run(urlish);
    }
  };
}

var repoFuncTests = vows.describe('Repo Functionality');

repoFuncTests.addBatch({
  'When we list branches of git://github.com/tillberg/cicero_demo.git': {
    topic: ctxLoad(),
    'we get an object of branch names': function(branches) {
      assert.equal(_.size(branches), 2);
      assert.match(branches.master, rgxSha1);
      assert.match(branches.old, rgxSha1);
    }
  },
  'When we get Repo of git://github.com/tillberg/euler.git': {
    topic: ctxLoad(),
    'we get a Repo object': function(repo) {
      assert.ok(repo.is(Repo));
    },
    'the basePath ends with a sha1 in hex of the repo': function(repo) {
      assert.isString(repo.basePath);
      assert.match(repo.basePath, /\/[0-9a-f]{40}$/);
      var expBasePath = crypto.createHash('sha1').update(repo.url).digest('hex');
      assert.equal(_.last(repo.basePath.split('/')), expBasePath);
    },
    'and then we get Repo of git://github.com/tillberg/euler.git': {
      topic: ctxLoad(),
      'it is the same as the first time we got that repo': function(repo) {
        assert.equal(repo, this.context.topics[1]);
      }
    },
    'and then in another Git instance we get Repo of git://github.com/tillberg/euler.git': {
      topic: ctxLoad(1),
      'it is a different object than the first time we got that repo': function(repo) {
        assert.notEqual(repo, this.context.topics[1]);
      }
    }
  },
  'When we get Repo of a new empty repo': {
    topic: ctxLoad(),
    'and get master': {
      topic: function(repo) {
        repo.branch('master', this.callback);
      },
      'and we should get an error because master does not exist': function(err, tree) {
        assert.ok(err);
        assert.isUndefined(tree);
      }
    }
  },
  'When we get master of a new repo-A': {
    topic: ctxLoad(),
    'and get README': {
      topic: function(repo) {
        repo.readFile('README', this.callback);
      },
      'we should get a file that says hello': function(err, data) {
        assert.ifError(err);
        assert.equal(data, 'helloA\n');
      }
    }
  },
  'When we get master of a new repo-A': {
    topic: ctxLoad(),
    'and get README': {
      topic: function(repo) {
        repo.readFile('README', this.callback);
      },
      'and then commit a change': {
        topic: function(readme, tree) {
          var repo = tree.repo;
          var callback = this.callback;
          initRepo(repo.url, 'B', function() { callback(null, repo); });
        },
        'and get README of the new sha1': {
          topic: function(repo) {
            var callback = this.callback;
            exec('git', ['rev-parse', 'HEAD'], { cwd: repo.url }, function(err, data) {
              var sha1 = _.trim(data);
              repo.tree(sha1).readFile('README', callback);
            });
          },
          'and we should get the new README file (which requires re-fetching)': function(err, readme) {
            assert.ifError(err);
            assert.equal(readme, 'helloB\n');
          }
        }
      }
    }
  }
});
repoFuncTests.export(module);

// Remove the old gitfs-var folder.  We do this kind of sloppily so
// that the `Basic Usage` tests can just use gitfs without going
// through the `getGit()` guard like the code above.
try { fs.renameSync('gitfs-var', 'gitfs-destroy'); } catch (ex) { }
exec('rm', ['-rf', 'gitfs-destroy'], { cwd: './' });

var basicUsageTests = vows.describe('Basic Usage');
basicUsageTests.addBatch({
  'If we load a file from a repo': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').readFile('README', this.callback);
    },
    'We should get the contents': function(err, data) {
      assert.ifError(err);
      assert.match(data, /Project Euler in Ruby and Scala/);
    }
  },
  'We can get the SHA1 of a branch': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').branch('master', this.callback);
    },
    'and it is correct': function(err, tree) {
      assert.ifError(err);
      assert.equal(tree.sha1, '62220098cf3a628110022f770fe8af874f547d4a');
    }
  },
  'We can get the full rev list of a repo': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').getAllRevs(this.callback);
    },
    'and it should have the correct number of items': function(err, revs) {
      assert.ifError(err);
      assert.lengthOf(revs, 69);
      _.each(revs, function(rev) { assert.match(rev, rgxSha1); });
    }
  },
  'We can checkout a snapshot of a repo to a local path': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').checkout('var/euler', this.callback);
    },
    'and it doesn\'t error out': function(err, d) {
      assert.ifError(err);
    },
    'then load a file from the local path': {
      topic: function() {
        fs.readFile('var/euler/euler.rb', 'utf8', this.callback);
      },
      'and the file should contain a method to find the sum of weird numbers': function(err, data) {
        assert.ifError(err);
        assert.match(data, /nums\.find_all\{\|n\| n\.is_weird\(maxd\)\}\.sum/);
      }
    },
    'then do a find on the checkout path': {
      topic: function() {
        exec('find', ['-type', 'f'], { cwd: 'var/euler/' }, this.callback);
      },
      'and we should find 12 items': function(err, data) {
        assert.ifError(err);
        // Specifically, we don't want a copy of any git-specific stuff
        assert.lengthOf(_.trim(data).split('\n'), 12);
      }
    }
  },
  'We can get a listing of all files in a repo': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').lsAll(this.callback);
    },
    'and there should be 12 items': function(err, files) {
      assert.ifError(err);
      assert.equal(_.size(files), 12);
    },
    'and src/main/scala/Euler.scala should have a sha1 for its blob': function(err, files) {
      assert.match(files['src/main/scala/Euler.scala'], rgxSha1);
    },
    'and if we read a file directly and by using the sha1 we got above': {
      topic: function(files) {
        async.parallel([function(done) {
          gitfs.repo('git://github.com/tillberg/euler.git').readFile('src/main/scala/Euler.scala', done);
        }, function(done) {
          gitfs.repo('git://github.com/tillberg/euler.git')._readBlob(files['src/main/scala/Euler.scala'], done);
        }], this.callback);
      },
      'they should be identical': function(err, bothContents) {
        assert.ifError(err);
        assert.lengthOf(bothContents[0], bothContents[1].length);
        assert.equal(bothContents[0], bothContents[1]);
      }
    }
  },
  'We can get a file from a specific version of a repo': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/euler.git').tree('e9aa251ff406451af7775cb14ec3d878e4afac61').readFile('euler.rb', this.callback);
    },
    'and it should have the contents as of that version': function(err, data) {
      assert.match(data, /class Array\; def sum/);
      assert.lengthOf(data, 885);
    }
  },
  'We can get a file from a non-master branch of a repo': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/cicero_demo.git').branch('old').readFile('doc/index.html', this.callback);
    },
    'and it should have the correct `old` text': function(err, data) {
      assert.ifError(err);
      assert.match(data, /This is the old branch/);
      assert.lengthOf(data, 101);
    }
  },
  'We can get a file that does not exist': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/cicero_demo.git').readFile('doesnotexist', this.callback);
    },
    'and err should be raised accordingly': function(err, data) {
      assert.ok(err);
      assert.isUndefined(data); // Shouldn't get data back
    }
  },
  'We can get a repo with two Repo objects simultaneously': {
    topic: function() {
      async.map([1, 2], function(i, cb) {
        gitfs.workspaceNoMemo().repo('git://github.com/tillberg/cicero_demo_conf.git').readFile('cicero.conf.yaml', cb);
      }, this.callback);
    },
    'and we should get identical correct contents without error': function(err, results) {
      assert.ifError(err);
      assert.lengthOf(results, 2);
      assert.match(results[0], /git:\/\/github\.com\/tillberg\/cicero_demo\.git/);
      assert.equal(results[0], results[1]);
    }
  },
  // Performance tests should really be run independently
  'We can time how long it takes to check out the same repo 10 times': {
    topic: function() {
      var t; // Only start the timer after the first item
      var callback = this.callback;
      async.forEachSeries(_.range(10), function(i, done) {
        gitfs.repo('git://github.com/tillberg/cicero_demo.git').checkout('var/perftest-' + i, function(err) {
          if (t === undefined) t = time();
          done(err);
        });
      }, function(err) {
        callback(err, time() - t);
      });
    },
    'and it should take less than 300 ms': function(err, time) {
      assert.ifError(err);
      if (time > 300) assert.isFalse(time);
    }
  },
  'We can commit a change to a repo': {
    topic: function() {
      var callback = this.callback;
      var repo = gitfs.repo('git://github.com/tillberg/cicero_demo.git').branch('master', function(err, tree) {
        var origSha1 = tree.sha1;
        tree.readFile('app/demo2.js', function(err, data) {
          var newdata = data.replace('hi, ', 'arrr, me matey ');
          tree.commit(origSha1, 'commit message', {
            'app/demo2.js': newdata
          }, function(err, newTree) {
            callback(err, newTree, tree);
          });
        });
      });
    },
    'and we should get a new sha1 for the new commit': function(err, newTree, tree) {
      assert.ifError(err);
      assert.notEqual(tree, newTree);
      assert.notEqual(tree.sha1, newTree.sha1);
      assert.match(tree.sha1, rgxSha1);
      assert.match(newTree.sha1, rgxSha1);
    },
    'and we get the file we changed': {
      topic: function(newTree) {
        newTree.readFile('app/demo2.js', this.callback);
      },
      'it should contain the modified text': function(err, data) {
        assert.ifError(err);
        assert.match(data, /arrr, me matey/);
      }
    }
  },
  'We can get the diff of two trees where a file was changed': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/cicero_demo.git').diffTree('5cd63b4498d90c7036cffde9cf2b7afaa4c99bf3', '6696ce5508476edf460080b065d209af2f17c685', this.callback);
    },
    'and they should show one file change': function(err, diff) {
      assert.ifError(err);
      assert.lengthOf(diff, 1);
      var diff0 = diff[0];
      assert.equal(diff0.type, 'change');
      assert.equal(diff0.before.path, diff0.after.path); 
      assert.equal(diff0.before.sha1, 'd7f0dbb626c1007fc9c98cb96a09636c76655ea0');
      assert.equal(diff0.after.sha1, '9e7d57c75f8ec3caf31156d5fbd19185e713e0ee');
    }
  },
  'We can get the diff of two trees where a file was renamed and another was added': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/cicero_demo.git').diffTree('1edd86578abb8b6e5b18edaf1ea91000ddc91eb7', '34f7e06bc113b02d5f9a762624fdf806e102007d', this.callback);
    },
    'and the diff should show the changes': function(err, diff) {
      assert.ifError(err);
      assert.lengthOf(diff, 2);
      var diffAdd = _.find(diff, function(d) { return d.type === 'add' });
      assert.equal(diffAdd.after.sha1, 'cc1bdd8bbb1ca19af7e1fe42c37da53847a85d7c');
      assert.equal(diffAdd.after.path, 'doc/favicon.ico');
      var diffRename = _.find(diff, function(d) { return d.type === 'rename'; });
      assert.equal(diffRename.before.sha1, diffRename.after.sha1); 
      assert.equal(diffRename.before.path, 'README');
      assert.equal(diffRename.after.path, 'README.md');
    }
  },
  'We can get the diff of two trees where a file was deleted': {
    topic: function() {
      gitfs.repo('git://github.com/tillberg/cicero_demo.git').diffTree('19cf84c83245869a1872fda3e2fdb86cf3c886c4', '1edd86578abb8b6e5b18edaf1ea91000ddc91eb7', this.callback);
    },
    'and the diff should show the change': function(err, diff) {
      assert.ifError(err);
      assert.lengthOf(diff, 1);
      var diff0 = diff[0];
      assert.equal(diff0.type, 'delete');
      assert.equal(diff0.before.path, 'doc/favicon.ico');
      assert.equal(diff0.before.sha1, '2218e13156ee3ab883cc27e8f2be10cd89bb504f');
    }
  }
});
basicUsageTests.export(module);
