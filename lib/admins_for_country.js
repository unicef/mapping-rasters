var elasticsearch = require('es');
var options = {
  _index: 'admins',
  _type: 'admin'
};

var es = elasticsearch(options);

exports.admins_per_country = function() {
  return new Promise( (resolve, reject) => {
    var admins = require('../../download_admin_shapefiles_and_import_geojson_to_elasticsearch/data/santiblanko/COL_2.json');
    admins = admins.features.filter(admin => {
      //console.log(admin.properties, admin.geometry.coordinates)
      return admin; //.properties.WCOLGEN02_=== 2;
    })
    resolve(admins);
  })
}

// exports.admins_per_country = function() {
//   return new Promise( (resolve, reject) => {
//     es.search({
//       "query": {
//         "match": {
//             "properties.pub_src": "santiblanko"}
//       }
//     }, function(err, data) {
//       if (err) {
//         console.log(err);
//         resolve([]);
//       }
//       var admins = data.hits.hits.map(function(e) {
//         return e
//       });
//       resolve(admins)
//     });
//   })
// }
