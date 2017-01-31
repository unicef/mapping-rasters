var config = require('../config');
var rasterDir = config.rasterDir;
var fs = require('fs');
var LineByLineReader = require('line-by-line');
var bs = require('binarysearch');
var bluebird = require('bluebird');
var st = require('geojson-bounds');
var search = require('./search');
var jsts = require('jsts');
var geojsonReader = new jsts.io.GeoJSONReader();

/**
 * Isolate fragment of row that corresponds to geoshape.
 * Then search each point to see if it falls within geoshape
 * @param{array} line - Entire row of pixel values
 * @param{number} count - Number of current row of raster
 * @param{object} direction_indexes - Key value table of direction to row/column index
 * @param{string} file - Name of raster file to read
 * @param{object} meta - Meta data for raster file
 * @param{array} lats - All latitude points
 * @param{array} lats - All longitude points
 * @return{Promise} Fulfilled when all values return from search
 */
function process_line(obj, direction_indexes, meta, lats, lons, admin, jstsPolygon, admin_to_pop) {
  var line = obj.line;
  var count = obj.count;
  return new Promise(function(resolve, reject) {
      var lines_of_meta = meta.num_lines;
      // console.log(
      //   lats[direction_indexes.n],
      //   lats[direction_indexes.s],
      //   lons[direction_indexes.w],
      //   lons[direction_indexes.e]
      // )
      // Isolate fragment of row that corresponds to geoshape.
      // scores are all pixels that fall within the bounding box of the shape.
      var scores = line.split(/\s+/).slice(
0
      );
      // Only search scores that are not null
      // Raster in this example has NODATA_value: -3.4028234663852885981e+38
      // Create key value store of row index to pixel value
      scores = scores.reduce(function(h, e, i) {
        if (e != meta.NODATA_value) {
          h[i] = e;
        }
        return h;
      }, {});

    //  console.log(lines_of_meta, '_____', scores, lats[count - lines_of_meta], lons[direction_indexes.e])
    bluebird.each(Object.keys(scores), function(index, i) {
      index = parseInt(index);
      var lat_lon = [lons[index], lats[count - lines_of_meta]];
      return search_coords(lat_lon, parseFloat(scores[index]), admin, jstsPolygon, admin_to_pop, count);
    }, {concurrency: 1000}).then(function() {
      resolve();
    })
  })
}

/**
 * Search point within polygon
 * @param{array} lat_lon - latitude, longitude
 * @param{number} count - pixel value
 * @return{Promise} Fulfilled when search is complete and value added to admin_id
 */
function search_coords(lat_lon, score, admin, jstsPolygon, admin_to_pop, count) {
  return new Promise((resolve, reject) => {
    var point = {
      type: 'Point',
      coordinates: lat_lon
    };
    var jstsPoint = geojsonReader.read(point);
    //console.log(admin.properties.WCOLGEN02_, count, jstsPoint.within(jstsPolygon), lat_lon);
    if (!jstsPoint.within(jstsPolygon)) {
      resolve();
    } else {
      if (score) {
        var admin_id = admin.properties.WCOLGEN02_ + '-' + admin.properties.NOMBRE_MPI + '_' + admin.properties.NOMBRE_CAB
        //var admin_id = admin.properties.id
        admin_to_pop[admin_id] = admin_to_pop[admin_id] ? admin_to_pop[admin_id] + score : score;
      }
      resolve();
    }
  })

  // return new Promise(function(resolve, reject) {
  //   search.search_coords([lat_lon[1], lat_lon[0]]).then(function(admin_id) {
  //     // No admin was found
  //     if (admin_id.length === 0) {
  //       // console.log(count, admin.properties.WCOLGEN02_, 'fail', lat_lon)
  //         resolve();
  //     } else {
  //       //console.log(count, admin.properties.WCOLGEN02_, 'TRUE!')
  //       admin_to_pop[admin_id] = admin_to_pop[admin_id] ? admin_to_pop[admin_id] + score : score;
  //       resolve();
  //     }
  //   })
  // })
}

/**
 * Open raster and go to row that matches the northern most point of the geoshape
 * Send line to process_line function which will see if pixels within column range falls within bounds of geoshape
 * @param{number} row_num - Number of row to pass to process_line
 * @param{object} direction_indexes - Key value table of direction to row/column index
 * @param{string} file - Name of raster file to read
 * @param{object} meta - Meta data for raster file
 * @param{array} lats - All latitude points
 * @param{array} lats - All longitude points
 * @return{Promise} Fulfilled when file is closed.
 */
exports.process_rows = function(row_indexes, direction_indexes, file, meta, lats, lons, admin, jstsPolygon, admin_to_pop) {
  return new Promise((resolve, reject) => {
    var lines = [];
    var count = 0;
    var lr = new LineByLineReader(rasterDir + file + '.asc');
    lr.on('error', function (err) {
      console.log(err);
      return reject(err);
    });

    lr.on('line', function (line) {
      count++;
        // scores = line.split(/\s+/).reduce(function(h, e, i) {
        //   if (e != meta.NODATA_value) {
        //     h[i] = e;
        //   }
        //   return h;
        // }, {});
        // console.log(count, scores)
      if (count >= row_indexes[0] && count <= row_indexes[row_indexes.length-1]) {
        scores = line.split(/\s+/).reduce(function(h, e, i) {
          if (e != meta.NODATA_value) {
            h[i] = e;
          }
          return h;
        }, {});

        lines.push({
          line: line,
          count: count
        });
      }
      if (count === row_indexes[row_indexes.length-1]) {
        lr.end();
      }
    });
    lr.on('end', function () {

      bluebird.each(lines, (line) => {
        return process_line(line, direction_indexes, meta, lats, lons, admin, jstsPolygon, admin_to_pop)
      }, {concurrency: 1000})
      .then(() => {
        lines = [];
        resolve();
        }
      )
    });
  })
}

// /**
//  * Open raster and go to row that matches the northern most point of the geoshape
//  * Send line to process_line function which will see if pixels within column range falls within bounds of geoshape
//  * @param{number} row_num - Number of row to pass to process_line
//  * @param{object} direction_indexes - Key value table of direction to row/column index
//  * @param{string} file - Name of raster file to read
//  * @param{object} meta - Meta data for raster file
//  * @param{array} lats - All latitude points
//  * @param{array} lats - All longitude points
//  * @return{Promise} Fulfilled when file is closed.
//  */
// exports.go_to_row = function(row_num, direction_indexes, file, meta, lats, lons, admin, jstsPolygon, admin_to_pop) {
//   return new Promise((resolve, reject) => {
//     var count = 0;
//     var lr = new LineByLineReader(rasterDir + file + '.asc');
//     lr.on('error', function (err) {
//       console.log(err);
//       return reject(err);
//     });
//
//     lr.on('line', function (line) {
//       count++;
//       if (count === 1) {
//         // Pause line reader so that end of file isn't reached
//         lr.pause();
//         process_line(line, count, direction_indexes, meta, lats, lons, admin, jstsPolygon, admin_to_pop)
//         .then(() => {
//           // lr.resume();
//           lr.end();
//         })
//       }
//     });
//     lr.on('end', function () {
//       resolve();
//     });
//   })
// }

/**
 * Assign latitude longitude to pixel
 *
 * @param{object} meta - meta data that describes raster file
 * @param{float} x - Row number of current pixel
 * @param{float} y - Column number of current pixel, i.e index in row.
 * @return{Promise} Fulfilled when geojson is returned.
 */
exports.assign_latlon_to_pixel = function(meta, y, x) {
  var lon = parseFloat(meta.xllcorner) + (x * (meta.dx || meta.cellsize))
  var lat = parseFloat(meta.yllcorner) + ((meta.nrows - y) * (meta.dy || meta.cellsize))
  return [lat, lon];
}

/**
 * Return array of northern, southern, eastern, western most points
 * of a geo polygon
 * @param{geojson} geojson - Polygon or Multipolygon of an administrative region
 * @return{Promise} Fulfilled when geojson is returned.
 */
get_direction_bounds = function(geoshape) {
  return {
    n: st.yMax(geoshape),
    s: st.yMin(geoshape),
    w: st.xMin(geoshape),
    e: st.xMax(geoshape)
  }
}

/**
 * Return begin and end indexes in latitude and longitude arrays
 * for segments that are within bounding box of polygon
 * @param{object} direction_points - Polygon or Multipolygon of an administrative region
 * @return{object} Object with indexes in latitudes and longitudes arrays
 */
exports.get_direction_indexes = function (geojson, lats, lons) {
  // Get n, s, e, w, bounds of geo polygon
  var direction_boundaries = get_direction_bounds(geojson);
  // Initialize an hash to store indexes in lat/lon arrays where polygon overlaps
  var direction_indexes = {};
  // Latitude array goes positive to negative
  // Need neg to pos for binary search
  var temp_lats = lats.slice().reverse();
  var n_index = bs.closest(temp_lats, direction_boundaries.n);
  // Use one index closer north
  direction_indexes.n = lats.length - n_index - 1;

  var s_index = bs.closest(temp_lats, direction_boundaries.s);

  direction_indexes.s = lats.length - s_index + 1;
  direction_indexes.e = bs.closest(lons, direction_boundaries.e) + 1;
  direction_indexes.w = bs.closest(lons, direction_boundaries.w);
  if (direction_indexes.w != 0) {
    direction_indexes.w -= 1;
  }
  return direction_indexes;
}

exports.fetch_meta_for_raster = (dir, file) => {
  var meta = {};
  return new Promise((resolve, reject) => {
    var lr = new LineByLineReader(dir + file + '.asc');
    lr.on('error', err => {
        // 'err' contains error object
    });

    lr.on('line', line => {
      var line = line.split(/\s+/);
      if (line.length > 2) {
        lr.end();
      } else {
        meta[line[0]] = line[1];
      }
    });

    lr.on('end', () => {
      // Store number of lines at top of raster
      // used for meta data. Needed later for getting to right row num.
      meta.num_lines = Object.keys(meta).length;
      resolve(meta);
        // All lines are read, file is closed now.
    });
  })
}
