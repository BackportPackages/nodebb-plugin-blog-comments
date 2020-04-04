(function (module) {
	"use strict";

	var Comments = {};

	var db = require.main.require('./src/database');
	var meta = require.main.require('./src/meta');
	var posts = require.main.require('./src/posts');
	var topics = require.main.require('./src/topics');
	var user = require.main.require('./src/user');
	var groups = require.main.require('./src/groups');
	var fs = module.parent.require('fs');
	var path = module.parent.require('path');
	var async = module.parent.require('async');
	var winston = module.parent.require('winston');
	var nconf = module.parent.require('nconf');
	var relativePath = nconf.get('relative_path');

	module.exports = Comments;

	Comments.getCommentData = function (req, res, callback) {
		var tid = req.params.id,
			pagination = req.params.pagination ? req.params.pagination : 0,
			uid = req.user ? req.user.uid : 0;

		async.parallel({
			posts: function (next) {
				topics.getTopicPosts(tid, 'tid:' + tid + ':posts', 0 + req.params.pagination * 10, 9 + req.params.pagination * 9, uid, true, next);
			},
			postCount: function (next) {
				topics.getTopicField(tid, 'postcount', next);
			},
			user: function (next) {
				user.getUserData(uid, next);
			},
			isAdministrator: function (next) {
				user.isAdministrator(uid, next);
			},
			isPublisher: function (next) {
				groups.isMember(uid, 'publishers', next);
			},
			category: function (next) {
				topics.getCategoryData(tid, next);
			},
			mainPost: function (next) {
				topics.getMainPost(tid, uid, next);
			}
		}, function (err, data) {
			var hostUrls = (meta.config['blog-comments:url'] || '').split(','),
				url;

			hostUrls.forEach(function (hostUrl) {
				hostUrl = hostUrl.trim();
				if (hostUrl[hostUrl.length - 1] === '/') {
					hostUrl = hostUrl.substring(0, hostUrl.length - 1);
				}

				if (hostUrl === req.get('origin')) {
					url = req.get('origin');
				}
			});

			if (!url) {
				winston.warn('[nodebb-plugin-blog-comments] Origin (' + req.get('origin') + ') does not match hostUrls: ' + hostUrls.join(', '));
			}

			res.header("Access-Control-Allow-Origin", url);
			res.header('Access-Control-Allow-Headers', 'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept');
			res.header("Access-Control-Allow-Credentials", "true");

			var posts = data.posts.filter(function (post) {
				if (post.user.picture) {
					post.user.picture = post.user.picture.replace(relativePath, '');
				}
				return !post.deleted;
			});

			if (data.user.picture) {
				data.user.picture = data.user.picture.replace(relativePath, '');
			}

			var top = true;
			var bottom = false;
			var compose_location = meta.config['blog-comments:compose-location'];
			if (compose_location === "bottom") {
				bottom = true;
				top = false;
			}

			res.json({
				posts: posts,
				postCount: data.postCount,
				user: data.user,
				template: Comments.template,
				token: req.csrfToken && req.csrfToken(),
				isAdmin: !data.isAdministrator ? data.isPublisher : data.isAdministrator,
				isLoggedIn: !!uid,
				tid: tid,
				category: data.category,
				mainPost: data.mainPost ? data.mainPost[0] : null,
				atBottom: bottom,
				atTop: top,
				poweredByText: meta.config['blog-comments:powered-by-text'],
				poweredByUrl: meta.config['blog-comments:powered-by-url'],
			});
		});
	};

	Comments.replyToComment = function (req, res, callback) {
		var content = req.body.content,
			tid = req.body.tid,
			url = req.body.url,
			uid = req.user ? req.user.uid : 0;

		topics.reply({
			tid: tid,
			uid: uid,
			content: content,
			req: req,
		}, function (err, postData) {
			if (err) {
				return res.redirect(url + '?error=' + err.message + '#nodebb-comments');
			}

			res.redirect(url + '#nodebb-comments');
		});
	};

	Comments.addLinkbackToArticle = function (post, callback) {
		var hostUrls = (meta.config['blog-comments:url'] || '').split(','),
			position;

		posts.getPostField(post.pid, 'blog-comments:url', function (err, url) {
			if (url) {
				hostUrls.forEach(function (hostUrl, i) {
					if (url.indexOf(hostUrl.trim().replace(/^https?:\/\//, '')) !== -1) {
						position = i;
					}
				});

				var blogName = (meta.config['blog-comments:name'] || '');
				blogName = parseInt(blogName.split(',')[position], 10) || parseInt(blogName.split(',')[0], 10) || 1;

				post.profile.push({
					content: "Posted from <strong><a href=" + url + " target='blank'>" + blogName + "</a></strong>"
				});
			}

			callback(err, post);
		});
	};

	Comments.addAdminLink = function (custom_header, callback) {
		custom_header.plugins.push({
			"route": "/blog-comments",
			"icon": "fa-book",
			"name": "Blog Comments"
		});

		callback(null, custom_header);
	};

	function renderAdmin(req, res, callback) {
		res.render('comments/admin', {});
	}

	Comments.init = function (params, callback) {
		var app = params.router,
			middleware = params.middleware,
			controllers = params.controllers;

		fs.readFile(path.resolve(__dirname, './public/templates/comments/comments.tpl'), function (err, data) {
			Comments.template = data.toString();
		});

		app.get('/comments/get/:id/:pagination?', middleware.applyCSRF, Comments.getCommentData);
		app.post('/comments/reply', Comments.replyToComment);
		app.get('/admin/blog-comments', middleware.admin.buildHeader, renderAdmin);
		app.get('/api/admin/blog-comments', renderAdmin);

		callback();
	};

}(module));
