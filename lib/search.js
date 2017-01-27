var elasticsearch = require('es');
var options = {
  _index: 'admins',
  _type: 'admin'
};

var es = elasticsearch(options);

function select_best_admin(admins) {
  var admin = admins.filter(function(admin) {
    return admin.pub_src === 'santiblanko';
  }).sort(function(a, b) {
     return b.admin_level - a.admin_level
  })[0];
  if (admin) {
    return admin;
  } else {
    return admins.sort(function(a, b) {
       return b.admin_level - a.admin_level
    })[0];
  }
};

exports.search_coords = function(coords) {
  var lat = coords[0];
  var lon = coords[1];

  return new Promise(function(resolve, reject) {
    es.search({
      // query: {
      //   match_all: {
      //   }
      // },
      // "query": {
      //     "filtered": {
      //       "query": {
      //         "match": {
      //           "properties.pub_src": "santiblanko"
      //         }
      //       }
      //     }
      // },
      "query": {
         "filtered": {
            "query": {
               "match_all": {}
            },
            "filter": {
               "bool": {
                  "must": [
                     {
                        "term": {
                          "properties.admin_level": "2"
                        }
                     },
                     {
                        "term": {
                          "properties.pub_src": "santiblanko"
                        }
                     },
                     {  
                      "term": {
                        "properties.ISO": "col"
                       }
                     }
                  ]
               }
            }
         }
      },
      filter: {
        geo_shape: {
          geometry: {
            relation: 'intersects',
            shape: {
              coordinates: [lon, lat],
              type: 'point'
            }
          }
        }
      }
    }, function(err, data) {
      if (err) {
        console.log(err);
        resolve([]);
      }
      if (data.hits.total === 0) {
        resolve([]);
      } else {
//        data.hits.hits.forEach(function(e) {
//        });
        var admins = data.hits.hits.map(function(e) {
          return e._source.properties.admin_id
        });
        resolve(select_best_admin(admins))
      }
    });
  });
}
