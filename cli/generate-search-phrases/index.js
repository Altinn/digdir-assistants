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
var instructor_1 = require("@instructor-ai/instructor");
// Assuming use of CommonJS modules
var Typesense = require("typesense");
var config = require("../lib/config").config;
var typesenseSearch = require("../lib/typesense-search");
var OpenAI = require("openai");
var zod_1 = require("zod");
// const dotenv = require("dotenv");
var sha1 = require("sha1");
// dotenv.config();
var cfg = config();
var openAI = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});
var openaiClientInstance = (0, instructor_1.default)({
    client: openAI,
    mode: "FUNCTIONS",
    debug: process.env.DEBUG_INSTRUCTOR == "true",
});
var SearchPhraseSchema = zod_1.z.object({
    searchPhrase: zod_1.z.string(),
});
var SearchPhraseListSchema = zod_1.z.object({
    searchPhrases: zod_1.z.array(SearchPhraseSchema),
});
var generatePrompt = "Please analyze the contents of the following documentation article and generate a list of English phrases that you would expect to match the following document. \nDO NOT include the phrases \"Altinn Studio\", \"Altinn 3\" or \"Altinn apps\".\n\nDocument:\n\n";
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var args, collectionNameTmp, client, durations, page, pageSize, jobPageSize, totalStart, searchResponse, searchHits, docIndex, searchHit, url, existingPhrases, contentMd, checksumMd, existingPhraseCount, storedChecksum, checksumMatches, start, result, search_phrases, _i, _a, document_1, docId, error_1, uploadBatch, _b, _c, _d, index, phrase, batch, results, failedResults;
        var _e, _f, _g, _h;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    args = process.argv.slice(2);
                    if (args.length === 0) {
                        console.log("Usage: node index.js <collectionNameTmp>");
                        process.exit(1);
                    }
                    collectionNameTmp = args[0];
                    client = new Typesense.TypesenseClient(cfg.TYPESENSE_CONFIG);
                    durations = {
                        total: 0,
                        queryDocs: 0,
                        generatePhrases: 0,
                        storePhrases: 0,
                    };
                    page = 1;
                    pageSize = 10;
                    jobPageSize = 2;
                    totalStart = Date.now();
                    _j.label = 1;
                case 1:
                    if (!(page <= jobPageSize)) return [3 /*break*/, 14];
                    console.log("Retrieving content_markdown for all urls, page ".concat(page, " (page_size=").concat(pageSize, ")"));
                    return [4 /*yield*/, typesenseSearch.typesenseRetrieveAllUrls(page, pageSize)];
                case 2:
                    searchResponse = _j.sent();
                    durations.queryDocs += Date.now() - totalStart;
                    searchHits = searchResponse.results.flatMap(function (result) {
                        return result.grouped_hits.flatMap(function (hit) {
                            return hit.hits.map(function (document) { return ({
                                id: document.document.id,
                                url: document.document.url_without_anchor,
                                contentMarkdown: document.document.content_markdown || "",
                            }); });
                        });
                    });
                    console.log("Retrieved ".concat(searchHits.length, " urls."));
                    if (searchHits.length === 0) {
                        console.log("Last page with results was page ".concat(page - 1));
                        return [3 /*break*/, 14];
                    }
                    docIndex = 0;
                    _j.label = 3;
                case 3:
                    if (!(docIndex < searchHits.length)) return [3 /*break*/, 13];
                    searchHit = searchHits[docIndex];
                    url = searchHit.url;
                    return [4 /*yield*/, lookupSearchPhrases(url, collectionNameTmp)];
                case 4:
                    existingPhrases = _j.sent();
                    contentMd = searchHit.contentMarkdown;
                    checksumMd = contentMd ? sha1(contentMd) : null;
                    existingPhraseCount = existingPhrases.found || 0;
                    if (existingPhraseCount > 0) {
                        storedChecksum = ((_g = (_f = (_e = existingPhrases.hits) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.document) === null || _g === void 0 ? void 0 : _g.checksum) || "";
                        checksumMatches = storedChecksum === checksumMd;
                        if (checksumMatches) {
                            console.log("Found existing phrases and checksum matches, skipping for url: ".concat(url));
                            docIndex++;
                            return [3 /*break*/, 3];
                        }
                    }
                    console.log("Generating search phrases for url: ".concat(url));
                    start = performance.now();
                    return [4 /*yield*/, generateSearchPhrases(searchHit)];
                case 5:
                    result = _j.sent();
                    durations.generatePhrases += performance.now() - start;
                    durations.total += Math.round(performance.now() - totalStart);
                    search_phrases = [];
                    if (result.function !== null) {
                        search_phrases = result.function.search_phrases.map(function (context) { return ({
                            search_phrase: context.search_phrase,
                        }); });
                    }
                    else {
                        search_phrases = [];
                    }
                    console.log("Generated search phrases for: ".concat(url, "\n"));
                    _i = 0, _a = existingPhrases.hits || [];
                    _j.label = 6;
                case 6:
                    if (!(_i < _a.length)) return [3 /*break*/, 11];
                    document_1 = _a[_i];
                    docId = ((_h = document_1.document) === null || _h === void 0 ? void 0 : _h.doc_id) || "";
                    if (!docId) return [3 /*break*/, 10];
                    _j.label = 7;
                case 7:
                    _j.trys.push([7, 9, , 10]);
                    return [4 /*yield*/, client
                            .collections(collectionNameTmp)
                            .documents(docId)
                            .delete()];
                case 8:
                    _j.sent();
                    console.log("Search phrase ID ".concat(docId, " deleted for url: ").concat(url));
                    return [3 /*break*/, 10];
                case 9:
                    error_1 = _j.sent();
                    if (error_1 instanceof Typesense.exceptions.ObjectNotFound) {
                        console.log("Search phrase ID ".concat(docId, " not found in collection \"").concat(collectionNameTmp, "\""));
                    }
                    return [3 /*break*/, 10];
                case 10:
                    _i++;
                    return [3 /*break*/, 6];
                case 11:
                    uploadBatch = [];
                    for (_b = 0, _c = search_phrases.entries(); _b < _c.length; _b++) {
                        _d = _c[_b], index = _d[0], phrase = _d[1];
                        console.log(phrase);
                        batch = {
                            doc_id: searchHit.id || "",
                            url: url,
                            search_phrase: phrase.search_phrase || "",
                            sort_order: index,
                            item_priority: 1,
                            updated_at: Math.floor(new Date().getTime() / 1000),
                            checksum: checksumMd,
                        };
                        uploadBatch.push(batch);
                    }
                    return [4 /*yield*/, client.collections(collectionNameTmp)
                            .documents
                            .import(uploadBatch, { action: "upsert", return_id: true })];
                case 12:
                    results = _j.sent();
                    failedResults = results.filter(function (result) { return !result.success; });
                    if (failedResults.length > 0) {
                        console.log("The following search_phrases for url:\n  \"".concat(url, "\"\n were not successfully upserted to typesense:\n").concat(failedResults));
                    }
                    docIndex += 1;
                    return [3 /*break*/, 3];
                case 13:
                    page += 1;
                    return [3 /*break*/, 1];
                case 14: return [2 /*return*/];
            }
        });
    });
}
main();
function lookupSearchPhrases(url, collectionNameTmp) {
    return __awaiter(this, void 0, void 0, function () {
        var retryCount, lookupResults, existingPhrases, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    retryCount = 0;
                    _a.label = 1;
                case 1:
                    if (!true) return [3 /*break*/, 9];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 8]);
                    return [4 /*yield*/, typesenseSearch.lookupSearchPhrases(url, collectionNameTmp)];
                case 3:
                    lookupResults = _a.sent();
                    existingPhrases = lookupResults.results[0];
                    return [2 /*return*/, existingPhrases];
                case 4:
                    e_1 = _a.sent();
                    console.error("Exception occurred while looking up search phrases for url: ".concat(url, "\n Error: ").concat(e_1));
                    if (!(retryCount < 10)) return [3 /*break*/, 6];
                    retryCount++;
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 5000); })];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 1];
                case 6: throw e_1;
                case 7: return [3 /*break*/, 8];
                case 8: return [3 /*break*/, 1];
                case 9: return [2 /*return*/];
            }
        });
    });
}
function generateSearchPhrases(searchHit) {
    return __awaiter(this, void 0, void 0, function () {
        var retryCount, content, queryResult, e_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    retryCount = 0;
                    _a.label = 1;
                case 1:
                    if (!true) return [3 /*break*/, 9];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 8]);
                    content = searchHit.content_markdown || "";
                    return [4 /*yield*/, openaiClientInstance.chat.completions.create({
                            model: process.env.OPENAI_API_MODEL_NAME,
                            response_model: {
                                schema: SearchPhraseListSchema,
                                name: "RagPromptReplySchema",
                            },
                            temperature: 0.1,
                            messages: [
                                { role: "system", content: "You are a helpful assistant." },
                                { role: "human", content: prompt + content },
                            ],
                            max_retries: 0,
                        })];
                case 3:
                    queryResult = _a.sent();
                    return [2 /*return*/, queryResult];
                case 4:
                    e_2 = _a.sent();
                    console.error("Exception occurred while generating search phrases for url: ".concat(searchHit.url || "", "\n Error: ").concat(e_2));
                    if (!(retryCount < 10)) return [3 /*break*/, 6];
                    retryCount++;
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 5000); })];
                case 5:
                    _a.sent();
                    return [3 /*break*/, 1];
                case 6: throw e_2;
                case 7: return [3 /*break*/, 8];
                case 8: return [3 /*break*/, 1];
                case 9: return [2 /*return*/];
            }
        });
    });
}
