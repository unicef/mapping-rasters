### Map geojson to raster files and aggregate pixel values by the features (polygons, multipolygons) that they fall within.

- This is a component of [MagicBox](https://github.com/unicef/magicbox/wiki)
- Requires the [GDAL - Geospatial Data Abstraction Library](http://www.gdal.org/) to convert shapefile to geojson
    - (On Mac OSX: brew install gdal)
    - [Ubuntu](http://www.sarasafavi.com/installing-gdalogr-on-ubuntu.html)

### Install
Follow link above to install the [GDAL](http://www.gdal.org) library.

- `git clone git@github.com:unicef/mapping-rasters.git`
- `cd mapping-rasters`
- `mkdir data`
- `cp config-sample.js config.js`

### Try it out with this sample use case
Satellites take images of the earth. Based on the amount of light seen at night in any region, it's possible to estimate population. Let's aggregate the population of Colombia by municipality, or, in UN terms, [administrative region](https://en.wikipedia.org/wiki/Administrative_division) level 2!

The output of this exercise will be a key value store of [admin id](https://medium.com/@mikefabrikant/using-open-and-private-data-to-improve-decision-making-in-the-humanitarian-world-magic-box-and-da57dfe7d492) to population figure.

- Navigate to [worldpop.org.uk Colombia](http://www.worldpop.org.uk/data/summary/?contselect=Americas&countselect=Colombia&typeselect=Population)
- Scroll to bottom and click **browse individual files**
- Download "COL_ppp_v2b_2015_UNadj" to data directory

The raster is encoded as a tif, so we **could** convert to text with [gdal_translate](http://www.gdal.org/gdal_translate.html):

  `gdal_translate -of AAIGrid input.tif output.asc`

However, this file is 1.5G and has 21,152 rows times 17,883 columns of data. That command outputs a 2.5G file with 378,261,216 data points!

To accelerate aggregation, we can reduce the size of the output with the -outsize option:  

`gdal_translate -of AAIGrid -outsize 25% 25% input.tif output.asc`

The result is a  75% smaller 584M file, now with 5288 rows by 4470 columns, or 23,637,360 data points.

run `node translate.js -f COL_ppp_v2b_2015_UNadj -r 25`

### Meta data for the raster
gdal_translate outputs a .asc file that contains meta info useful to assigning latitude longitude coordinates to each value.

run ` head -7 data/COL_ppp_v2b_2015_UNadj.asc`

And you'll see:
`ncols        4470
nrows        5288
xllcorner    -81.739290337968
yllcorner    -4.227887418487
dx           0.003333759262
dy           0.003333200000
NODATA_value  -3.4028234663852885981e+38`

xllcorner and yllcorner (lower left corner) is the lat/lon coordinates for the first value on the last line of the file.

dx and dy are the dimensions of the pixel cell size.

### Assigning latitude longitude to a pixel
    /**
     * Assign latitude longitude to pixel
     *
     * @param{object} meta - meta data that describes raster file
     * @param{float} x - Row number of current pixel
     * @param{float} y - Column number of current pixel, i.e index in row.
     * @return{Promise} Fulfilled when geojson is returned.
     */
    function assign_latlon_to_pixel(meta, y, x) {
      var lon = parseFloat(meta.xllcorner) + (x * (meta.dx || meta.cellsize))
      var lat = parseFloat(meta.yllcorner) + ((meta.nrows - y) * (meta.dy || meta.cellsize))
      return [lat, lon];
    }

### Aggregation

Run: `node aggregate.js -f COL_ppp_v2b_2015_UNadj.asc -g COL_2.json`

*This repository comes with geojson for Colombia with admin 2 resolution.*

#### Strategy
Given the lat/lon coords of the top left value, we can use the number of rows and columns to create an array of all latitudes and another for all longitudes.

Foreach polygon, get the bounding box.

    var st = require('geojson-bounds');
    /**
     * Return array of northern, southern, eastern, western most points
     * of a geo polygon
     * @param{geojson} geoshape - Geojson polygon or multipolygon of an administrative region
     * @return{Promise} Fulfilled when geojson is returned.
     */
    function get_direction_bounds(geoshape) {
      return {
        n: st.yMax(geoshape);
        s: st.yMin(geoshape);
        w: st.xMin(geoshape)
        e: st.xMax(geoshape)
      }
    }

Find first/last row numbers and column range that covers the bounding box of the polygon.

    /**
     * Return begin and end indexes in latitude and longitude arrays
     * for segments that are within bounding box of polygon
     * @param{object} direction_points - Polygon or Multipolygon of an administrative region
     * @return{object} Object with indexes in latitudes and longitudes arrays
     */
    function get_direction_indexes(geojson, lats, lons) {
      // Get n, s, e, w, bounds of geo polygon
      var direction_boundaries = get_direction_bounds(geojson);
      // Initialize an hash to store indexes in lat/lon arrays where polygon overlaps
      var direction_indexes = {};
      // Latitude array goes positive to negative
      // Need neg to pos for binary search
      var temp_lats = lats.slice().reverse();
      var n_index = bs.closest(temp_lats, direction_boundaries.n);
      direction_indexes.n = lats.length - n_index;
      var s_index = bs.closest(temp_lats, direction_boundaries.s);
      direction_indexes.s = lats.length - s_index;
      direction_indexes.e = bs.closest(lons, direction_boundaries.e);
      direction_indexes.w = bs.closest(lons, direction_boundaries.w);
      return direction_indexes;
    }

Now, for each admin, prepare the row numbers and column ranges of pixels to attempt to match to its geojson coordinates

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

 Open raster and go to row that matches the northern most point of the geoshape. Send line to process_line function which will see if pixel falls within bounds of geoshape.

     /**
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
           if (count >= row_indexes[0] || count === row_indexes[row_indexes.length-1]) {
             lines.push(line);
           }
           if (count > row_indexes[row_indexes.length-1]) {
             lr.end();
           }
         });
         lr.on('end', function () {
           bluebird.each(lines, (line) => {
             return process_line(line, count, direction_indexes, meta, lats, lons, admin, jstsPolygon, admin_to_pop)
           }, {concurrency: 1000})
           .then(() => {
             lines = [];
             resolve();
             }
           )
         });
       })
     }

Isolate fragment of row that corresponds to geoshape.  Then search each point to see if it falls within geoshape

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
    function process_line(line, count, direction_indexes, meta, lats, lons) {
      var lines_of_meta = meta.num_lines;

      // Isolate fragment of row that corresponds to geoshape.
      // scores are all pixels that fall within the bounding box of the shape.
      var scores = line.split(/\s+/).slice(
        direction_indexes[2], // West
        direction_indexes[3]  // East
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

      return new Promise(function(resolve, reject) {
        bluebird.each(Object.keys(scores), function(index, i) {
          index = parseInt(index);
          var lat_lon = [lats[count - lines_of_meta], lons[i]];
          return search_coords(lat_lon, parseFloat(scores[index]));
        }, {concurrency: 1000}).then(function() {
          resolve();
        })
      })
    }

Search point within polygon

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
        if (jstsPoint.within(jstsPolygon)) {
          resolve();
        } else {
          admin_to_pop[admin.properties.WCOLGEN02_] = admin_to_pop[admin.properties.WCOLGEN02_] ? admin_to_pop[admin.properties.WCOLGEN02_] + score : score;
          resolve();
        }
      })
