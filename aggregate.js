var config = require('./config');
var rasterDir = config.rasterDir;
var geojsonDir = config.geojsonDir;
var helper = require('./lib/util');
var async = require('async');
var start_time = new Date();
var moment = require('moment');
var get_admins = require('./lib/admins_for_country');
var fs = require('fs');
var bluebird = require('bluebird');
var admin_to_pop = {};
var ArgumentParser = require('argparse').ArgumentParser;
var lats = [];
var lons = [];
var jsts = require('jsts');
var geojsonReader = new jsts.io.GeoJSONReader();
var parser = new ArgumentParser({
  version: '0.0.1',
  addHelp: true,
  description: 'Aggregate a csv of airport by admin 1 and 2'
});

parser.addArgument(
  ['-f', '--file'],
  {help: 'Name of tif file'}
);

parser.addArgument(
  ['-g', '--geojson'],
  {help: 'Name of geojson file to map to raster'}
);

var args = parser.parseArgs();
var file = args.file || 'COL_ppp_v2b_2015_UNadj2'
var exec = require('child_process').exec;

/**
 * Aggregate pixels that fall within bounding box of geo polygon
 * @param{object} admin - Geojson feature
 * @param{object} meta - meta data for raster file
 * @return{Promise} Fulfilled when all pixels in polygon bounding box are aggregated.
 */
function aggregate_values(admin, meta) {
  var jstsPolygon = geojsonReader.read({
    type: admin.geometry.type,
    coordinates: admin.geometry.coordinates
  });

  return new Promise((resolve, reject) => {
    // Prepare to identify which rows in the raster relate to the geoshape
    // The first lines of the raster are meta info. About 7 lines.
    var num_lines_meta = meta.num_lines;
    // This object will have:
    // the first row with pixels related to the geoshapes's northern most point.
    // the last row with pixels related to the geoshapes's southern most point.
    // the first and last column indexes with pixels related to the geoshapes's western and eastern most points.
    var direction_indexes = helper.get_direction_indexes(admin.geometry, lats, lons);
    // console.log(direction_indexes, lats[direction_indexes.s+7], lons[direction_indexes.e])
    // Create an array to pass to bluebird that contains all rows to process
    row_indexes = Array.range(num_lines_meta + direction_indexes.n, num_lines_meta + direction_indexes.s);
    helper.process_rows(row_indexes, direction_indexes, file, meta, lats, lons, admin, jstsPolygon, admin_to_pop)
    .then(() => { resolve(); })
    // bluebird.each(row_indexes, (row_num) => {
    //   return helper.go_to_row(row_num, direction_indexes, file, meta, lats, lons, admin, jstsPolygon, admin_to_pop)
    // }, {concurrency: 1})
    // .then(() => {
    //   resolve();
    // })
  })
}

async.waterfall([
  // Retreive object with meta data for raster file.
  // Example:
  // { ncols: '4470', nrows: '5288', xllcorner: '-81.739290337968', yllcorner: '-4.227887418487',
  // dx: '0.003333759262', dy: '0.003333200000', NODATA_value: '-3.4028234663852885981e+38' }
  function(callback) {
    helper.fetch_meta_for_raster(rasterDir, file)
    .then(meta => {
      callback(null, meta)
    })
  },

  // Build array of latitudes
  function(meta, callback) {
    var num_rows = parseInt(meta.nrows);
    for(i = 0; i < num_rows; i++) {
      lats.push(helper.assign_latlon_to_pixel(meta, i, 0)[0])
    }
    callback(null, meta);
  },

  // Build array of longitudes
  function(details, callback) {
    var num_cols = parseInt(details.ncols);
    for(i = 0; i < num_cols; i++) {
      lons.push(helper.assign_latlon_to_pixel(details, 0, i)[1])
    }
    callback(null, details);
  },

  // Load array of admins
  function(meta, callback) {
    // Get array of admins per country
    get_admins.admins_per_country()
    .then(admins => {
      bluebird.each(admins, admin => {
      console.log(admin_to_pop, moment().diff(start_time, 'minutes'))
      console.log('\n')

        return aggregate_values(admin, meta);
      }, {concurrency: 1})
      .then(() => {
          callback(null, meta);
      })
    })

  }
], function(err, result) {
  if (err) {
    console.log(err);
  }
  console.log('All done!', new Date());
  console.log(admin_to_pop)
  fs.writeFile(rasterDir + file + '.json', JSON.stringify(admin_to_pop), (err) => {
    if (err) throw err;
    console.log('It\'s saved!', moment().diff(start_time, 'minutes'));
    process.exit();
  });
});

// function add_admin_id(admin) {
//   var admin_id;
//   admin.properties.ISO = country_iso;
//   admin.properties.admin_level = admin_level;
//   admin.properties.pub_src = src;
//   if (src.match('santiblanko')) {
//     admin_id = 0;
//     admin.properties.ID_1 = admin.properties.DPTO;
//     admin.properties.ID_2 = admin.properties.WCOLGEN02_;
//   }
//   admin_id = country_iso.toLowerCase();
//   ['ID_0', 'ID_1', 'ID_2'].forEach(function(e) {
//     if (admin.properties[e]) {
//      admin_id = admin_id + '_' + admin.properties[e];
//     }
//   });
//   admin.properties.admin_id = admin_id + '_' + admin_series;
//   admin.properties.timezone = tz.add_timezone(admin);
//   return admin;
// };

Array.range= function(a, b, step){
    var A= [];
    if(typeof a== 'number'){
        A[0]= a;
        step= step || 1;
        while(a+step<= b){
            A[A.length]= a+= step;
        }
    }
    else{
        var s= 'abcdefghijklmnopqrstuvwxyz';
        if(a=== a.toUpperCase()){
            b=b.toUpperCase();
            s= s.toUpperCase();
        }
        s= s.substring(s.indexOf(a), s.indexOf(b)+ 1);
        A= s.split('');
    }
    return A;
}
