(function(angular) {
   "use strict";
   var appServices = angular.module('myApp.services', ['myApp.utils', 'feedTheFire']);

   /**
    * A service that authenticates against Fireabase using simple login
    */
   appServices.factory('authManager', ['fbRef', '$firebaseSimpleLogin', 'authScopeUtil', 'authProviders', '$rootScope', function(fbRef, $firebaseSimpleLogin, authScopeUtil, authProviders, $rootScope) {
      var auth = $firebaseSimpleLogin(fbRef());
      var providers = {};
      angular.forEach(authProviders, function(p) {
         providers[p.id] = angular.extend({preferred: false}, p);
      });

      // provide some convenience wrappers on $firebaseSimpleLogin so it's easy to extend behavior and isolate upgrades
      return {
         login: function(providerId) {
            auth.$login(providerId, { rememberMe: true, scope: 'email'});
         },

         logout: function() {
            $rootScope.$broadcast('authManager:beforeLogout', auth);
            auth.$logout();
         },

         getProviders: function() {
            return _.extend({}, providers);
         },

         setPreferred: function() {
            angular.forEach(providers, function(p, k) {p.preferred = (k === provider)});
         },

         addToScope: function($scope) {
            authScopeUtil($scope);
         }
      };
   }]);

   /**
    * A simple utility to monitor changes to authentication and set some values in scope for use in bindings/directives/etc
    */
   appServices.factory('authScopeUtil', ['$log', 'updateScope', 'localStorage', '$location', function($log, updateScope, localStorage, $location) {
      return function($scope) {
         $scope.auth = {
            authenticated: false,
            user: null,
            name: null,
            provider: localStorage.get('authProvider')
         };

         $scope.$on('$firebaseSimpleLogin:login', _loggedIn);
         $scope.$on('$firebaseSimpleLogin:error', function(err) {
            $log.error(err);
            _loggedOut();
         });
         $scope.$on('$firebaseSimpleLogin:logout', _loggedOut);

         function parseName(user) {
            switch(user.provider) {
               case 'persona':
                  return (user.id||'').replace(',', '.');
               default:
                  return user.id;
            }
         }

         function _loggedIn(evt, user) {
            localStorage.set('authProvider', user.provider);
            $scope.auth = {
               authenticated: true,
               user: user.id,
               name: parseName(user),
               provider: user.provider
            };
            updateScope($scope, 'auth', $scope.auth, function() {
               if( !($location.path()||'').match('/hearth') ) {
                  $location.path('/hearth');
               }
            });
         }

         function _loggedOut() {
            $scope.auth = {
               authenticated: false,
               user: null,
               name: null,
               provider: $scope.auth && $scope.auth.provider
            };
            updateScope($scope, 'auth', $scope.auth, function() {
               $location.search('feed', null);
               $location.path('/demo');
            });
         }
      }
   }]);

   /**
    * Some straightforward scope methods for dealing with feeds and articles; these have no dependencies
    */
   appServices.factory('feedScopeUtils', ['localStorage', '$timeout', 'syncData', function (localStorage, $timeout, syncData) {
      return function ($scope, provider, userId) {
         $scope.noFeeds = true;
         $scope.showRead = false;

         //todo snag this from $location?
         $scope.link = $scope.isDemo ? 'demo' : 'hearth';

         $scope.isActive = function (feedId) {
            return $scope.activeFeed === feedId;
         };

         $scope.showAllFeeds = function () {
            return !$scope.activeFeed;
         };

         $scope.openFeedBuilder = function ($event) {
            $event && $event.preventDefault();
            $scope.$broadcast('modal:customFeed');
         };

         $scope.openArticle = function (article, $event) {
            if ($event) {
               $event.preventDefault();
               $event.stopPropagation();
            }
            $scope.$broadcast('modal:article', article);
         };

         $scope.filterMethod = function (article) {
            return passesFilter(article) && notRead(article) && activeFeed(article);
         };

         $scope.orderMethod = function (article) {
            var v = article[$scope.sortField];
            return $scope.sortDesc ? 0 - parseInt(v) : parseInt(v);
         };

         $scope.markArticleRead = function (article, $event) {
            if ($scope.isDemo) {
               return;
            }
            if ($event) {
               $event.preventDefault();
               $event.stopPropagation();
            }
            var f = article.feed;
            if (!_.has($scope.readArticles, article.feed)) {
               $scope.readArticles[f] = {};
            }
            $scope.readArticles[f][article.$id] = Date.now();
         };

         $scope.markFeedRead = function (feedId, $event) {
            if ($event) {
               $event.preventDefault();
               $event.stopPropagation();
            }
            angular.forEach($scope.articles, function (article) {
               if (article.feed === feedId) {
                  $scope.markArticleRead(article);
               }
            });
         };

         $scope.markAllFeedsRead = function ($event) {
            if ($event) {
               $event.preventDefault();
               $event.stopPropagation();
            }
            angular.forEach($scope.feeds, function (feed) {
               $scope.markFeedRead(feed.id, $event);
            });
         };

         $scope.noVisibleArticles = function () {
            return !$scope.loading && !$scope.noFeeds && countActiveArticles() === 0;
         };

         var to;
         $scope.startLoading = function () {
            $scope.loading = true;
            to && $timeout.cancel(to);
            to = $timeout(function () {
               $scope.loading = false;
            }, 4000);
            return to;
         };

         $scope.stopLoading = function () {
            to && $timeout.cancel(to);
            to = null;
            if ($scope.loading) {
               $timeout(function () {
                  $scope.loading = false;
               });
            }
         };

         $scope.sortField = 'date';

         $scope.$watch('sortDesc', function () {
            //todo store in firebase
            localStorage.set('sortDesc', $scope.sortDesc);
         });

         $scope.sortDesc = !!localStorage.get('sortDesc');

         // 2-way synchronize of the articles this user has marked as read
         $scope.readArticles = {};
         if (!$scope.isDemo) {
            syncData(['user', provider, userId, 'read'], 250).$bind($scope, 'readArticles');
         }

         function passesFilter(article) {
            if (_.isEmpty($scope.articleFilter)) {
               return true;
            }
            var txt = ($scope.articleFilter || '').toLowerCase();
            return _.find(article, function (v, k) {
               return !!(v && (v + '').toLowerCase().indexOf(txt) >= 0);
            });
         }

         function notRead(article) {
            return $scope.showRead || !_.has($scope.readArticles, article.feed) || !_.has($scope.readArticles[article.feed], article.$id);
         }

         function activeFeed(article) {
            return !$scope.activeFeed || $scope.activeFeed === article.feed;
         }

         function countActiveArticles() {
            if ($scope.activeFeed) {
               return $scope.counts[$scope.activeFeed] || 0;
            }
            else {
               return _.reduce($scope.counts, function (memo, num) {
                  return memo + num;
               }, 0);
            }
         }

         $scope.startLoading();
      }
   }]);

   appServices.factory('disposeOnLogout', ['$rootScope', function($rootScope) {
      var disposables = [];

      $rootScope.$on('authManager:beforeLogout', function() {
         angular.forEach(disposables, function(fn) {
            fn();
         });
         disposables = [];
      });

      return function(fnOrRef, event, callback) {
         var fn;
         if( arguments.length === 3 ) {
            fn = function() {
               fnOrRef.off(event, callback);
            }
         }
         else if( angular.isObject(fnOrRef) && fnOrRef.hasOwnProperty('$off') ) {
            fn = function() {
               fnOrRef.$off();
            }
         }
         else {
            fn = fnOrRef;
         }
         disposables.push(fn);
         return fnOrRef;
      }
   }]);

})(angular);
