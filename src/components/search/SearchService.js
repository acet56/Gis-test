goog.provide('ga_search_service');

goog.require('ga_reframe_service');
(function() {

  var module = angular.module('ga_search_service', [
    'ga_reframe_service'
  ]);

  var DMSDegree = '[0-9]{1,2}[°|º]\\s*';
  var DMSMinute = '[0-9]{1,2}[\'|′]';
  var DMSSecond = '(?:\\b[0-9]+(?:\\.[0-9]*)?|\\.' +
    '[0-9]+\\b)("|\'\'|′′|″)';
  var DMSNorth = '[N]';
  var DMSEast = '[E]';
  var MGRS = '^3[123][\\sa-z]{3}[\\s\\d]*';
  var regexpDMSN = new RegExp(DMSDegree +
    '(' + DMSMinute + ')?\\s*' +
    '(' + DMSSecond + ')?\\s*' +
    DMSNorth, 'g');
  var regexpDMSE = new RegExp(DMSDegree +
    '(' + DMSMinute + ')?\\s*' +
    '(' + DMSSecond + ')?\\s*' +
    DMSEast, 'g');
  var regexpDMSDegree = new RegExp(DMSDegree, 'g');
  var regexpCoordinate = new RegExp(
      '([\\d\\.\']+)[\\s,]+([\\d\\.\']+)' +
    '([\\s,]+([\\d\\.\']+)[\\s,]+([\\d\\.\']+))?');
  var regexMGRS = new RegExp(MGRS, 'gi');
  // Grid zone designation for Switzerland + two 100km letters + two digits
  // It's a limitiation of proj4 and a sensible default (precision is 10km)
  var MGRSMinimalPrecision = 7;

  var roundCoordinates = function(coords) {
    return [Math.round(coords[0] * 1000) / 1000,
      Math.round(coords[1] * 1000) / 1000];
  };

  module.provider('gaSearchGetCoordinate', function() {
    this.$get = function($window, $q, gaReframe) {

      return function(extent, query) {
        var position;

        // Parse MGRS notation
        var matchMGRS = query.match(regexMGRS);
        if (matchMGRS && matchMGRS.length === 1) {
          var mgrsStr = matchMGRS[0].split(' ').join('');
          if ((mgrsStr.length - MGRSMinimalPrecision) % 2 === 0) {
            var wgs84 = $window.proj4.mgrs.toPoint(mgrsStr);
            position = ol.proj.transform(wgs84, 'EPSG:4326', 'EPSG:21781');
            if (ol.extent.containsCoordinate(extent, position)) {
              return $q.when(roundCoordinates(position));
            }
          }
        }

        // Parse degree EPSG:4326 notation
        var matchDMSN = query.match(regexpDMSN);
        var matchDMSE = query.match(regexpDMSE);
        if (matchDMSN && matchDMSN.length === 1 &&
            matchDMSE && matchDMSE.length === 1) {
          var northing = parseFloat(matchDMSN[0].
              match(regexpDMSDegree)[0].
              replace('°', '').replace('º', ''));
          var easting = parseFloat(matchDMSE[0].
              match(regexpDMSDegree)[0].
              replace('°', '').replace('º', ''));
          var minuteN = matchDMSN[0].match(DMSMinute) ?
            matchDMSN[0].match(DMSMinute)[0] : '0';
          northing = northing +
            parseFloat(minuteN.replace('\'', '').
                replace('′', '')) / 60;
          var minuteE = matchDMSE[0].match(DMSMinute) ?
            matchDMSE[0].match(DMSMinute)[0] : '0';
          easting = easting +
            parseFloat(minuteE.replace('\'', '').
                replace('′', '')) / 60;
          var secondN =
            matchDMSN[0].match(DMSSecond) ?
              matchDMSN[0].match(DMSSecond)[0] : '0';
          northing = northing + parseFloat(secondN.replace('"', '').
              replace('\'\'', '').replace('′′', '').
              replace('″', '')) / 3600;
          var secondE = matchDMSE[0].match(DMSSecond) ?
            matchDMSE[0].match(DMSSecond)[0] : '0';
          easting = easting + parseFloat(secondE.replace('"', '').
              replace('\'\'', '').replace('′′', '').
              replace('″', '')) / 3600;
          position = ol.proj.transform([easting, northing],
              'EPSG:4326', 'EPSG:21781');
          if (ol.extent.containsCoordinate(
              extent, position)) {
            return $q.when(roundCoordinates(position));
          }
        }

        var match = query.match(regexpCoordinate);
        if (match) {
          var left = parseFloat(match[1].replace(/'/g, ''));
          var right = parseFloat(match[2].replace(/'/g, ''));
          // Old school entries like '600 000 200 000'
          if (match[3] != null) {
            left = parseFloat(match[1].replace(/'/g, '') +
                              match[2].replace(/'/g, ''));
            right = parseFloat(match[4].replace(/'/g, '') +
                               match[5].replace(/'/g, ''));
          }
          position = [left > right ? left : right,
            right < left ? right : left];
          // LV03 or EPSG:21781
          if (ol.extent.containsCoordinate(extent, position)) {
            return $q.when(roundCoordinates(position));
          }

          // Match decimal notation EPSG:4326
          if (left <= 180 && left >= -180 &&
              right <= 180 && right >= -180) {
            position = [left > right ? right : left,
              right < left ? left : right];
            position = ol.proj.transform(position, 'EPSG:4326', 'EPSG:21781');
            if (ol.extent.containsCoordinate(extent, position)) {
              return $q.when(roundCoordinates(position));
            }
          }

          // Match LV95 coordinates
          return gaReframe.get95To03(position).then(function(position) {
            if (ol.extent.containsCoordinate(extent, position)) {
              return roundCoordinates(position);
            }
          });
        }
        return $q.when(undefined);
      };
    };
  });

  module.provider('gaSearchLabels', function() {

    var preHighlight = '<span class="ga-search-highlight">';
    var postHighlight = '</span>';
    var ignoreTags = ['<b>', '</b>', preHighlight, postHighlight];

    var escapeRegExp = function(str) {
      return str.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&');
    };

    var getIndicesToIgnore = function(strIn) {
      var ignoreIndices = [];
      for (var i = 0; i < ignoreTags.length; i++) {
        var tag = ignoreTags[i];
        var regex = new RegExp(escapeRegExp(tag), 'gi');
        var result;
        while ((result = regex.exec(strIn))) {
          ignoreIndices.push([result.index, result.index + tag.length]);
        }
      }
      return ignoreIndices;
    };

    var ignore = function(indices, start, end) {
      for (var i = 0; i < indices.length; i++) {
        var ind = indices[i];
        if ((start >= ind[0] && start < ind[1]) ||
            (end > ind[0] && end <= ind[1])) {
          return true;
        }
      }
      return false;
    };

    var highlightWord = function(strIn, word) {
      if (!word.length) {
        return strIn;
      }
      var ignoreIndices = getIndicesToIgnore(strIn);
      var splits = strIn.split(new RegExp(escapeRegExp(word), 'gi'));
      var res = '';
      var i = 0;
      var olen = 0;
      var wlen = word.length;
      for (; i < splits.length - 1; i++) {
        res += splits[i];
        olen += splits[i].length;
        var skip = ignore(ignoreIndices, olen, olen + wlen);
        if (!skip) {
          res += preHighlight;
        }
        res += strIn.substring(olen, olen + wlen);
        if (!skip) {
          res += postHighlight;
        }
        olen += wlen;
      }
      res += splits[i];
      return res;
    };

    this.$get = function() {
      return {
        highlight: function(str, wordstring) {
          var words = wordstring.split(' ');
          var res = str;
          angular.forEach(words, function(w) {
            res = highlightWord(res, w);
          });
          return res;
        },
        cleanLabel: function(str) {
          return str.replace(/(<b>|<\/b>|<i>|<\/i>)/gi, '');
        }
      };
    };
  });

  module.provider('gaSearchTokenAnalyser', function() {

    var tokenlist = ['limit', 'origins'];
    var regs = {};

    for (var i = 0; i < tokenlist.length; i++) {
      var tk = tokenlist[i];
      regs[tk] = {
        tk: tk,
        list: new RegExp('(^ *' + tk + ': *\\w+|\\s+' + tk + ': *\\w+)', 'i'),
        value: new RegExp(tk + ': *(\\w+)', 'i')
      };
    }

    var apply = function(input, regs) {
      var res = regs.list.exec(input.query);
      if (res && res.length) {
        var value = regs.value.exec(res[0]);
        if (value && value.length >= 2) {
          input.parameters.push(regs.tk + '=' + value[1]);
        }
        // Strip token and value from query
        input.query = input.query.replace(res[0], '');
      }
    };

    this.$get = function() {

      return {
        run: function(q) {
          var res = {
            query: q,
            parameters: []
          };
          for (var reg in regs) {
            apply(res, regs[reg]);
          }
          return res;
        }
      };
    };
  });
})();
