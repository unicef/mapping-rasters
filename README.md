### Map geojson to raster files and aggregate pixel values by the features (polygons, multipolygons) that they fall within.

- This is a component of [MagicBox](https://github.com/unicef/magicbox/wiki)
- Requires the [GDAL - Geospatial Data Abstraction Library](http://www.gdal.org/) to convert shapefile to geojson
    - (On Mac OSX: brew install gdal)
    - [Ubuntu](http://www.sarasafavi.com/installing-gdalogr-on-ubuntu.html)

### Install
Follow link above to install the [GDAL](http://www.gdal.org) library.
`git clone git@github.com:unicef/mapping-rasters.git`
`cd mapping-rasters`
`mkdir data`
`cp config-sample.js config.js`

### Try it out with this sample use case
Satellites take images of the earth. Based on the amount of light seen at night in any region, it's possible to estimate population. Let's aggregate the popluation of Colombia by municpality, or, in UN terms, [administrative region](https://en.wikipedia.org/wiki/Administrative_division) level 2!
- Navigate to [worldpop.org.uk Colombia](http://www.worldpop.org.uk/data/summary/?contselect=Americas&countselect=Colombia&typeselect=Population)
- Scroll to bottom and click **browse individual files**
- Download "COL_ppp_v2b_2015_UNadj" to data directory

The raster is encoded as a tif, so we **could** convert to text with [gdal_translate](http://www.gdal.org/gdal_translate.html):
  `gdal_translate -of AAIGrid input.tif output.asc`
However, this file is 1.5G and has 21,152 rows times 17,883 columns of data. That command outputs a 9G file with 378,261,216 data points!

To accelerate aggregation, we can reduce the size of the output with the -outsize option:  `gdal_translate -of AAIGrid -outsize 25% 25% input.tif output.asc`

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

run `node aggregate.js -f COL_ppp_v2b_2015_UNadj.asc -g COL_2.json`
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
    exports.get_direction_bounds = function(geoshape) {
      return {
        n: st.yMax(geoshape);
        s: st.yMin(geoshape);
        w: st.xMin(geoshape)
        e: st.xMax(geoshape)
      }
    }

Find first/last row numbers and column range that covers the bounding box of the polygon.

    var bs = require('binarysearch');
    /**
     * Return begin and end indexes in latitude and longitude arrays
     * for segments that are within bounding box of polygon
     * @param{object} direction_points - Polygon or Multipolygon of an administrative region
     * @return{object} Object with indexes in latitudes and longitudes arrays
     */
    exports.get_direction_indexes = function (direction_boundaries, lats, lons) {
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
# mapping-rasters