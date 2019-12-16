'use strict';
const crypto = require('crypto');
const pug = require('pug');
const Cookies = require('cookies');
const moment = require('moment-timezone');
const util = require('./handler-util');
const Post = require('./post');

const trackingIdKey = 'tracking_id';

const oneTimeTokenMap = new Map(); 

function handle(req, res) {
  const cookies = new Cookies(req, res);
  const trackingId = addTrackingCookie(cookies, req.user);

  switch (req.method) {
    case 'GET':
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8'
        });
        Post.findAll({ order: [['id', 'DESC']] }).then((posts) => {
          posts.forEach((post) => {
            post.content = post.content.replace(/\+/g, ' ');
            post.formattedCreatedAt = moment(post.createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH時mm分ss秒');
          });
          const oneTimeToken = crypto.randomBytes(8).toString('hex');
          oneTimeTokenMap.set(req.user, oneTimeToken); //キーをユーザー名、値をトークンとする連想配列
          res.end(pug.renderFile('./views/posts.pug', {
            posts: posts,
            user: req.user,
            oneTimeToken: oneTimeToken
          }));
          console.info(
            `閲覧されました: user: ${req.user}, ` +
            `trackingId: ${trackingId},` +
            `IP-Address: ${req.connection.remoteAddress}, ` +
            `userAgent: ${req.headers['user-agent']} `
          );
        });
      break;
    case 'POST':
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      }).on('end', () => {
        const decoded = decodeURIComponent(body);
        const dataArray = decoded.split('&');
        const content = dataArray[0] ? dataArray[0].split('content=')[1] : '';
        const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
        if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
          console.info(`投稿されました: ${content}`);
          Post.create({
            content: content,
            trackingCookie: trackingId,
            postedBy: req.user
          }).then(() => {
            oneTimeTokenMap.delete(req.user);
            handleRedirectPosts(req, res);
          });
        } else {
          util.handleBadRequest(req, res);
        }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

function handleDelete(req, res) {
  switch (req.method) {
    case 'POST':
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      }).on('end', () => {
        const decoded = decodeURIComponent(body);
        const dataArray = decoded.split('&');
        const id = dataArray[0] ? dataArray[0].split('id=')[1] : '';
        const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
        if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
          Post.findByPk(id).then((post) => {
            if (req.user === post.postedBy || req.user === 'admin') {
              post.destroy().then(() => {
                console.info(
                  `削除されました: user: ${req.user}, ` +
                  `IP-Address: ${req.connection.remoteAddress}, ` +
                  `userAgent: ${req.headers['user-agent']} `
                );
                oneTimeTokenMap.delete(req.user);
                handleRedirectPosts(req, res);
              });
            }
          });
        } else {
          util.handleBadRequest(req, res);
        }
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

/**
 * cookieに含まれているトラッキングIDに異常がなければその値を返し、
 * 存在しない場合や異常なものである場合には、再度作成しCookieに付与してその値を返す
 * @param {Cookies} cookies
 * @param {String} userName
 * @return {String} トラッキングID
 */
function addTrackingCookie(cookies, userName) {
  const requestedTrackingId = cookies.get(trackingIdKey);
  if (isValidTrackingId(requestedTrackingId, userName)) {
    return requestedTrackingId;
  } else{
    const originalId = parseInt(crypto.randomBytes(7).toString('hex'), 16);
    const tomorrow = new Date(Date.now() + (1000 * 60 * 60 * 24));
    const trackingId = originalId + '_' + createValidHash(originalId, userName);
    cookies.set(trackingIdKey, trackingId, { expires: tomorrow });
    return trackingId;
  }
}

function isValidTrackingId(trackingId, userName) {
  if (!trackingId) {
    return false;
  }
  const splitted = trackingId.split('_');
  const originalId = splitted[0];
  const requestedHash = splitted[1];
  return createValidHash(originalId, userName) === requestedHash;
}

const secretKey =
`65f40a37b402343433f05d8f27f4c5ad6ab85c9da50ed74f415eae4f76036d62
ffc13fdf1e67ea78601cbe9676290b77375bec5bb97d2e22f9c8a55488c37147c
3d0323c852d950229b400f3a465ded9b34ccae4caddcebbf122fcc6a4e18fa70d
71d976c06bcc917ea20b29cc7defdba6d1dfef7162f3f923dfec7bdc5dd39c791
44208913d5aadc3192be9d49469c44f3c39537f1d6857162667feb51fe931b2b5
c26a1802f0513a084b34348583c1081aad18440896f26c6f48490d65e4b47441a
2cf23df5d8ccbfdb57a629d1434ffe5644202029e0a5272cf8f2ab1b9161aabc9
cb0a353598ebc0ccc87f8494948e121805fa776a98e45d0c027e6f80c3`

function createValidHash(originalId, userName) {
  const sha1sum = crypto.createHash('sha1');
  sha1sum.update(originalId + userName + secretKey);
  return sha1sum.digest('hex');
}

function handleRedirectPosts(req, res) {
  res.writeHead(303, {
    'Location': '/posts'
  });
  res.end();
}

module.exports = {
  handle,
  handleDelete
};