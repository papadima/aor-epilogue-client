import {
  fetchUtils,
  GET_LIST,
  GET_ONE,
  GET_MANY,
  GET_MANY_REFERENCE,
  CREATE,
  UPDATE,
  DELETE,
} from 'admin-on-rest';

const { queryParameters, fetchJson } = fetchUtils;

/**
 * Maps admin-on-rest queries to a epilogue powered REST API
 *
 * @see https://github.com/dchester/epilogue
 * @example
 *
 * GET_LIST     => GET http://my.api.url/posts?sort=-title&page=0&count=10
 * GET_ONE      => GET http://my.api.url/posts/123
 * GET_MANY     => GET http://my.api.url/posts/123, GET http://my.api.url/posts/456, GET http://my.api.url/posts/789
 * UPDATE       => PUT http://my.api.url/posts/123
 * CREATE       => POST http://my.api.url/posts/123
 * DELETE       => DELETE http://my.api.url/posts/123
 */
export default (apiUrl, httpClient = fetchJson, idsMapConfig = {}) => {
  /**
   * @param {Object} params Actual names of the id fields, depending on the resource name
   * @returns {String} Searched name of the id field
   */
  const getIdKey = ({ resource, idsMap = {} }) => idsMap[resource]
    || Object.entries(idsMap).reduce((r, [k, v]) => {
      const m = resource.match(new RegExp(k));
      if (m && m[0] === resource) {
        return v;
      }
      return r;
    }, undefined)
    || 'id';

  /**
   * @param {String} type One of the constants appearing at the top if this file, e.g. 'UPDATE'
   * @param {String} resource Name of the resource to fetch, e.g. 'posts'
   * @param {Object} params The REST request params, depending on the type
   * @returns {Object} { url, options } The HTTP request parameters
   */
  const convertRESTRequestToHTTP = (type, resource, params) => {
    let url = '';
    const options = {};
    const sortValue = ({ field, order }) => (order === 'DESC' ? `-${field}` : field);
    switch (type) {
      case GET_LIST: {
        const { page, perPage } = params.pagination;
        const query = {
          ...params.filter,
          sort: sortValue(params.sort),
          page: page - 1,
          count: perPage,
        };
        url = `${apiUrl}/${resource}?${queryParameters(query)}`;
        break;
      }
      case GET_ONE:
        url = `${apiUrl}/${resource}/${params.id}`;
        break;
      case GET_MANY_REFERENCE: {
        const { page, perPage } = params.pagination;
        const query = {
          ...params.filter,
          [params.target]: params.id,
          sort: sortValue(params.sort),
          page: page - 1,
          count: perPage,
        };
        url = `${apiUrl}/${resource}?${queryParameters(query)}`;
        break;
      }
      case UPDATE:
        url = `${apiUrl}/${resource}/${params.id}`;
        options.method = 'PUT';
        options.body = JSON.stringify(params.data);
        break;
      case CREATE:
        url = `${apiUrl}/${resource}`;
        options.method = 'POST';
        options.body = JSON.stringify(params.data);
        break;
      case DELETE:
        url = `${apiUrl}/${resource}/${params.id}`;
        options.method = 'DELETE';
        break;
      default:
        throw new Error(`Unsupported fetch action type ${type}`);
    }
    return { url, options };
  };

  /**
   * @param {Object} response HTTP response from fetch()
   * @param {String} type One of the constants appearing at the top if this file, e.g. 'UPDATE'
   * @param {String} resource Name of the resource to fetch, e.g. 'posts'
   * @param {Object} params The REST request params, depending on the type
   * @returns {Object} REST response
   */
  const convertHTTPResponseToREST = (response, type, resource, params) => {
    const { headers, json, body } = response;
    const headerName = 'Content-Range';
    const idKey = getIdKey({ resource, idsMap: idsMapConfig });
    switch (type) {
      case GET_LIST:
      case GET_MANY_REFERENCE:
        if (!headers.has(headerName)) {
          throw new Error(`The ${headerName} header is missing in the HTTP Response. The jsonServer REST client expects responses for lists of resources to contain this header with the total number of results to build the pagination. If you are using CORS, did you declare ${headerName} in the Access-Control-Expose-Headers header? Example ${headerName} value: items 0-9/100`);
        }
        return {
          data: json.map(item => ({ ...item, id: item[idKey] })),
          body,
          total: parseInt(headers.get(headerName).split('/').pop(), 10),
        };
      case CREATE:
        return {
          data: { ...params.data, id: json.id },
          body,
        };
      default:
        return {
          data: json ? { ...json, id: json[idKey] } : null,
          body,
        };
    }
  };

  /**
   * @param {string} type Request type, e.g GET_LIST
   * @param {string} resource Resource name, e.g. "posts"
   * @param {Object} payload Request parameters. Depends on the request type
   * @returns {Promise} the Promise for a REST response
   */
  return (type, resource, params) => {
    // json-server doesn't handle WHERE IN requests, so we fallback to calling GET_ONE n times instead
    if (type === GET_MANY) {
      return Promise
        .all(params.ids.map(id => httpClient(`${apiUrl}/${resource}/${id}`)))
        .then(responses => ({ data: responses.map(response => response.json) }));
    }
    const { url, options } = convertRESTRequestToHTTP(type, resource, params);
    return httpClient(url, options)
      .then(response => convertHTTPResponseToREST(response, type, resource, params));
  };
};
