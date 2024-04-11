"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupSearchPhrases = exports.setupSearchPhraseSchema = exports.typesenseRetrieveAllByUrl = exports.typesenseRetrieveAllUrls = exports.typesenseSearchMultipleVector = exports.lookupSearchPhrasesSimilar = exports.typesenseSearchMultiple = void 0;
var typesense_1 = require("typesense");
var config_1 = require("./config");
var zod_1 = require("zod");
var cfg = (0, config_1.config)();
;
var SearchPhrasesSchema = zod_1.z.object({
    searchQueries: zod_1.z.array(zod_1.z.string()),
});
function typesenseSearchMultiple(searchQueries) {
    return __awaiter(this, void 0, void 0, function () {
        var client, multiSearchArgs, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    console.log("incoming queries: ".concat(searchQueries));
                    multiSearchArgs = {
                        "searches": searchQueries.searchQueries.map(function (query) { return ({
                            "collection": process.env.TYPESENSE_DOCS_COLLECTION,
                            "q": query,
                            "query_by": "content,embedding",
                            "include_fields": "hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,url_without_anchor,type,id,content_markdown",
                            "group_by": "url_without_anchor",
                            "group_limit": 3,
                            "limit": 10,
                            "prioritize_exact_match": false,
                            "sort_by": "_text_match:desc",
                            "drop_tokens_threshold": 5,
                        }); }),
                    };
                    return [4 /*yield*/, client.multiSearch.perform(multiSearchArgs, {})];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response];
            }
        });
    });
}
exports.typesenseSearchMultiple = typesenseSearchMultiple;
function lookupSearchPhrasesSimilar(searchQueries) {
    return __awaiter(this, void 0, void 0, function () {
        var client, multiSearchArgs, response, searchPhraseHits, urlList, uniqueUrls;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    multiSearchArgs = {
                        "searches": searchQueries.searchQueries.map(function (query) { return ({
                            "collection": process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION,
                            "q": query,
                            "query_by": "search_phrase,phrase_vec",
                            "include_fields": "search_phrase,url",
                            "group_by": "url",
                            "group_limit": 1,
                            "limit": 20,
                            "sort_by": "_text_match:desc,_vector_distance:asc",
                            "prioritize_exact_match": false,
                            "drop_tokens_threshold": 5,
                        }); }),
                    };
                    return [4 /*yield*/, client.multiSearch.perform(multiSearchArgs, {})];
                case 1:
                    response = _a.sent();
                    searchPhraseHits = response.results.flatMap(function (result) { var _a; return (_a = result.grouped_hits) === null || _a === void 0 ? void 0 : _a.flatMap(function (hit) { return hit.hits; }); })
                        .sort(function (a, b) {
                        return (b === null || b === void 0 ? void 0 : b.hybrid_search_info.rank_fusion_score) -
                            (a === null || a === void 0 ? void 0 : a.hybrid_search_info.rank_fusion_score);
                    });
                    urlList = searchPhraseHits.map(function (phrase) {
                        var _a;
                        return ({
                            url: (phrase === null || phrase === void 0 ? void 0 : phrase.document.url) || '',
                            rank: (_a = phrase.hybrid_search_info) === null || _a === void 0 ? void 0 : _a.rank_fusion_score,
                        });
                    });
                    uniqueUrls = [];
                    urlList.forEach(function (url) {
                        if (!uniqueUrls.some(function (u) { return u.url === url.url; })) {
                            uniqueUrls.push(url);
                        }
                    });
                    return [2 /*return*/, uniqueUrls];
            }
        });
    });
}
exports.lookupSearchPhrasesSimilar = lookupSearchPhrasesSimilar;
function typesenseSearchMultipleVector(searchQueries) {
    return __awaiter(this, void 0, void 0, function () {
        var client, vectorQueries, multiSearchArgs, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    vectorQueries = [];
                    multiSearchArgs = {
                        "searches": vectorQueries.map(function (query) { return ({
                            "collection": process.env.TYPESENSE_DOCS_COLLECTION,
                            "q": "*",
                            "vector_query": "embedding:([".concat(query, "], k:10)"),
                            "include_fields": "hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,url_without_anchor,type,id,content_markdown",
                        }); }),
                    };
                    return [4 /*yield*/, client.multiSearch.perform(multiSearchArgs, {})];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response];
            }
        });
    });
}
exports.typesenseSearchMultipleVector = typesenseSearchMultipleVector;
function typesenseRetrieveAllUrls(page, pageSize) {
    return __awaiter(this, void 0, void 0, function () {
        var client, multiSearchArgs, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    multiSearchArgs = {
                        "searches": [{
                                "collection": process.env.TYPESENSE_DOCS_COLLECTION,
                                "q": "*",
                                "query_by": "url_without_anchor",
                                "include_fields": "url_without_anchor,content_markdown,id",
                                "group_by": "url_without_anchor",
                                "group_limit": 1,
                                "sort_by": "item_priority:asc",
                                "page": page,
                                "per_page": pageSize,
                            }],
                    };
                    return [4 /*yield*/, client.multiSearch.perform(multiSearchArgs, {})];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response];
            }
        });
    });
}
exports.typesenseRetrieveAllUrls = typesenseRetrieveAllUrls;
function typesenseRetrieveAllByUrl(urlList) {
    return __awaiter(this, void 0, void 0, function () {
        var client, urlSearches, multiSearchArgs, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    urlSearches = urlList.slice(0, 20).map(function (rankedUrl) { return ({
                        "collection": process.env.TYPESENSE_DOCS_COLLECTION,
                        "q": rankedUrl.url,
                        "query_by": "url_without_anchor",
                        "include_fields": "hierarchy.lvl0,hierarchy.lvl1,hierarchy.lvl2,hierarchy.lvl3,hierarchy.lvl4,url_without_anchor,type,id,content_markdown",
                        "filter_by": "url_without_anchor:=".concat(rankedUrl.url),
                        "group_by": "url_without_anchor",
                        "group_limit": 1,
                        "page": 1,
                        "per_page": 1,
                    }); });
                    multiSearchArgs = { "searches": urlSearches };
                    return [4 /*yield*/, client.multiSearch.perform(multiSearchArgs, {})];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response];
            }
        });
    });
}
exports.typesenseRetrieveAllByUrl = typesenseRetrieveAllByUrl;
function setupSearchPhraseSchema(collectionNameTmp) {
    return __awaiter(this, void 0, void 0, function () {
        var client, schema, error_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    schema = {
                        "name": collectionNameTmp,
                        "fields": [
                            { "name": "doc_id", "type": "string", "optional": false },
                            {
                                "name": "url",
                                "type": "string",
                                "optional": false,
                                "facet": true,
                                "sort": true,
                            },
                            { "name": "search_phrase", "type": "string", "optional": false },
                            {
                                "name": "sort_order",
                                "type": "int32",
                                "optional": false,
                                "sort": true,
                            },
                            {
                                "name": "phrase_vec",
                                "type": "float[]",
                                "optional": true,
                                "embed": {
                                    "from": ["search_phrase"],
                                    "model_config": {
                                        "model_name": "ts/all-MiniLM-L12-v2",
                                    },
                                },
                            },
                            { "name": "language", "type": "string", "facet": true, "optional": true },
                            { "name": "item_priority", "type": "int64" },
                            { "name": "updated_at", "type": "int64" },
                            { "name": "checksum", "type": "string" },
                        ],
                        "default_sorting_field": "sort_order",
                        "token_separators": ["_", "-", "/"],
                    };
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, , 7]);
                    return [4 /*yield*/, client.collections(collectionNameTmp).retrieve()];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 7];
                case 3:
                    error_1 = _a.sent();
                    if (!(error_1 instanceof typesense_1.default.Errors.ObjectNotFound)) return [3 /*break*/, 5];
                    console.log("Creating new collection:", collectionNameTmp);
                    return [4 /*yield*/, client.collections().create(schema)];
                case 4:
                    _a.sent();
                    console.log("Collection created successfully.");
                    return [3 /*break*/, 6];
                case 5: throw error_1;
                case 6: return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    });
}
exports.setupSearchPhraseSchema = setupSearchPhraseSchema;
function lookupSearchPhrases(url, collectionName) {
    return __awaiter(this, void 0, void 0, function () {
        var client, multiSearchArgs, response;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    client = new typesense_1.default.Client(cfg.TYPESENSE_CONFIG);
                    collectionName = collectionName ||
                        process.env.TYPESENSE_DOCS_SEARCH_PHRASE_COLLECTION;
                    multiSearchArgs = {
                        "searches": [{
                                "collection": collectionName,
                                "q": "*",
                                "query_by": "url",
                                "include_fields": "id,url,search_phrase,sort_order,updated_at,checksum",
                                "filter_by": "url:=".concat(url),
                                "sort_by": "sort_order:asc",
                                "per_page": 30,
                            }],
                    };
                    return [4 /*yield*/, client.multiSearch.perform(multiSearchArgs, {})];
                case 1:
                    response = _a.sent();
                    return [2 /*return*/, response];
            }
        });
    });
}
exports.lookupSearchPhrases = lookupSearchPhrases;
