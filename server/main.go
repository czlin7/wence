package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	appVersion       = "3"
	tushareEndpoint  = "https://api.tushare.pro"
	maxTushareBody   = 32 << 20
	dailyFields      = "ts_code,trade_date,open,high,low,close,pre_close,change,pct_chg,vol,amount"
	dailyBasicFields = "ts_code,trade_date,close,turnover_rate,volume_ratio,pe,pe_ttm,pb"
	finaFields       = "ts_code,ann_date,end_date,eps,roe,roe_waa,or_yoy,netprofit_yoy,gross_margin,debt_to_assets"
	moneyflowFields  = "ts_code,trade_date,buy_sm_vol,buy_sm_amount,sell_sm_vol,sell_sm_amount,buy_md_vol,buy_md_amount,sell_md_vol,sell_md_amount,buy_lg_vol,buy_lg_amount,sell_lg_vol,sell_lg_amount,buy_elg_vol,buy_elg_amount,sell_elg_vol,sell_elg_amount"
	stockBasicFields = "ts_code,symbol,name,area,industry,market,exchange,list_date"
)

type tushareClient struct {
	token         string
	http          *http.Client
	llm           *localLLM
	shutdownToken string
	shutdown      chan struct{}
}

type tushareEnvelope struct {
	Code int             `json:"code"`
	Msg  json.RawMessage `json:"msg"`
	Data *tushareTable   `json:"data"`
}

type tushareTable struct {
	Fields []string `json:"fields"`
	Items  [][]any  `json:"items"`
}

type stockListCache struct {
	sync.Mutex
	rows    []map[string]any
	expires time.Time
}

var (
	stockCache stockListCache
	codeRE     = regexp.MustCompile(`^\d{6}(\.(SH|SZ|BJ))?$`)
)

func main() {
	logPath := os.Getenv("WENCE_LOG_PATH")
	if logPath != "" {
		if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err == nil {
			if file, openErr := os.OpenFile(logPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600); openErr == nil {
				defer file.Close()
				log.SetOutput(io.MultiWriter(os.Stdout, file))
			} else {
				log.Printf("Unable to open log file: %v", openErr)
			}
		} else {
			log.Printf("Unable to create log directory: %v", err)
		}
	}

	webRoot := strings.TrimSpace(os.Getenv("WENCE_ROOT"))
	if webRoot == "" {
		webRoot = "web"
	}
	webRoot, err := filepath.Abs(webRoot)
	if err != nil {
		log.Fatalf("Resolve web directory: %v", err)
	}
	if info, statErr := os.Stat(filepath.Join(webRoot, "index.html")); statErr != nil || info.IsDir() {
		log.Fatalf("Web page not found in %s", webRoot)
	}

	port := strings.TrimSpace(os.Getenv("WENCE_PORT"))
	if port == "" {
		port = "8765"
	}
	if _, err := strconv.Atoi(port); err != nil {
		log.Fatalf("Invalid WENCE_PORT: %q", port)
	}
	llm, err := newLocalLLM(filepath.Dir(webRoot))
	if err != nil {
		log.Printf("Local language model unavailable: %v", err)
	}

	api := &tushareClient{
		token:         strings.TrimSpace(os.Getenv("TUSHARE_TOKEN")),
		llm:           llm,
		shutdownToken: strings.TrimSpace(os.Getenv("WENCE_SHUTDOWN_TOKEN")),
		shutdown:      make(chan struct{}, 1),
		http: &http.Client{
			Timeout: 45 * time.Second,
			Transport: &http.Transport{
				Proxy:               http.ProxyFromEnvironment,
				DialContext:         (&net.Dialer{Timeout: 12 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
				TLSHandshakeTimeout: 20 * time.Second,
				TLSClientConfig:     &tls.Config{MinVersion: tls.VersionTLS12},
				MaxIdleConns:        8,
				IdleConnTimeout:     60 * time.Second,
			},
		},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", api.healthHandler)
	mux.HandleFunc("/api/llm/status", api.localLLMStatusHandler)
	mux.HandleFunc("/api/llm/retry", api.localLLMRetryHandler)
	mux.HandleFunc("/api/talk", api.talkHandler)
	mux.HandleFunc("/api/shutdown", api.shutdownHandler)
	mux.HandleFunc("/api/analyze", api.analyzeHandler)
	mux.Handle("/", http.FileServer(http.Dir(webRoot)))

	server := &http.Server{
		Addr:              net.JoinHostPort("127.0.0.1", port),
		Handler:           withRequestLogging(mux),
		ReadHeaderTimeout: 8 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("Wence v%s listening at http://%s/", appVersion, server.Addr)
	serverErrors := make(chan error, 1)
	go func() { serverErrors <- server.ListenAndServe() }()
	interrupts := make(chan os.Signal, 1)
	signal.Notify(interrupts, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(interrupts)
	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("HTTP server stopped: %v", err)
		}
	case <-api.shutdown:
		log.Printf("Shutdown requested by launcher")
	case received := <-interrupts:
		log.Printf("Shutdown signal received: %s", received)
	}

	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownContext); err != nil {
		log.Printf("HTTP server shutdown: %v", err)
	}
	if api.llm != nil {
		api.llm.Close()
	}
}

func withRequestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		log.Printf("%s %s", r.Method, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}

func (c *tushareClient) healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version":          appVersion,
		"token_configured": c.token != "",
	})
}

func (c *tushareClient) localLLMStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if c.llm == nil {
		writeJSON(w, http.StatusOK, localLLMStatus{
			Status: "failed", Phase: "failed", Message: "此电脑暂不支持本地话术助手", Model: "Qwen3 1.7B",
		})
		return
	}
	writeJSON(w, http.StatusOK, c.llm.Status())
}

func (c *tushareClient) localLLMRetryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if c.llm == nil || !c.llm.Retry() {
		writeJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "本地话术助手当前无需重试"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
}

func (c *tushareClient) talkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if c.llm == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "本地话术助手暂不可用"})
		return
	}
	defer r.Body.Close()
	var input talkGenerationRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 24*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "回复请求格式无效"})
		return
	}
	replies, err := c.llm.Generate(r.Context(), input)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "本次本地生成未通过校验，请使用已核验的基础回复"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "replies": replies})
}

func (c *tushareClient) shutdownHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if c.shutdownToken == "" || r.Header.Get("X-Wence-Shutdown") != c.shutdownToken {
		writeJSON(w, http.StatusForbidden, map[string]any{"ok": false, "error": "Forbidden"})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true})
	select {
	case c.shutdown <- struct{}{}:
	default:
	}
}

func (c *tushareClient) analyzeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "Method not allowed"})
		return
	}
	if c.token == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Tushare Token is not configured. Restart the launcher and enter a token."})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	question := strings.TrimSpace(r.URL.Query().Get("question"))
	if query == "" || len(query) > 120 {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "Enter a stock code or name (up to 120 characters)."})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()
	data, err := c.analyze(ctx, query, question)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "data": data})
}

func (c *tushareClient) analyze(ctx context.Context, query, question string) (map[string]any, error) {
	master, masterErr := c.stockList(ctx)
	stock, resolveErr := resolveStock(query, master)
	if resolveErr != nil && codeRE.MatchString(strings.ToUpper(query)) {
		code := normalizeCode(query)
		rows, err := c.query(ctx, "stock_basic", map[string]string{"ts_code": code}, stockBasicFields)
		if err == nil && len(rows) > 0 {
			stock = rows[0]
			resolveErr = nil
		}
	}
	if resolveErr != nil {
		if masterErr != nil {
			return nil, fmt.Errorf("Could not load the stock list: %s", masterErr.Error())
		}
		return nil, resolveErr
	}
	tsCode := stringValue(stock["ts_code"])
	if tsCode == "" {
		return nil, errors.New("The selected stock has no Tushare code.")
	}

	end := time.Now().Format("20060102")
	startDaily := time.Now().AddDate(-2, 0, 0).Format("20060102")
	startFinance := time.Now().AddDate(-5, 0, 0).Format("20060102")
	requests := []struct {
		key    string
		api    string
		params map[string]string
		fields string
	}{
		{"daily", "daily", map[string]string{"ts_code": tsCode, "start_date": startDaily, "end_date": end}, dailyFields},
		{"daily_basic", "daily_basic", map[string]string{"ts_code": tsCode, "start_date": startDaily, "end_date": end}, dailyBasicFields},
		{"fina", "fina_indicator", map[string]string{"ts_code": tsCode, "start_date": startFinance, "end_date": end}, finaFields},
		{"moneyflow", "moneyflow", map[string]string{"ts_code": tsCode, "start_date": startDaily, "end_date": end}, moneyflowFields},
	}
	type result struct {
		key  string
		rows []map[string]any
		err  error
	}
	results := make(chan result, len(requests))
	for _, request := range requests {
		request := request
		go func() {
			rows, err := c.query(ctx, request.api, request.params, request.fields)
			results <- result{key: request.key, rows: rows, err: err}
		}()
	}

	data := map[string]any{
		"stock":         stock,
		"daily":         []map[string]any{},
		"daily_basic":   []map[string]any{},
		"fina":          []map[string]any{},
		"moneyflow":     []map[string]any{},
		"cross_section": nil,
		"question":      question,
	}
	apiErrors := map[string]string{}
	for range requests {
		result := <-results
		if result.err != nil {
			apiErrors[result.key] = result.err.Error()
			continue
		}
		data[result.key] = result.rows
	}
	if len(apiErrors) > 0 {
		data["errors"] = apiErrors
	} else {
		data["errors"] = map[string]string{}
	}

	daily, _ := data["daily"].([]map[string]any)
	if len(daily) == 0 {
		if message := apiErrors["daily"]; message != "" {
			return nil, fmt.Errorf("Daily price data is unavailable: %s", message)
		}
		return nil, errors.New("No daily price data was returned for this stock.")
	}
	sort.Slice(daily, func(i, j int) bool {
		return stringValue(daily[i]["trade_date"]) < stringValue(daily[j]["trade_date"])
	})
	data["daily"] = daily
	tradeDate := stringValue(daily[len(daily)-1]["trade_date"])
	if tradeDate != "" {
		crossRows, err := c.query(ctx, "daily", map[string]string{"trade_date": tradeDate}, dailyFields)
		if err != nil {
			apiErrors["market_snapshot"] = err.Error()
		} else if len(crossRows) > 0 {
			data["cross_section"] = makeCrossSection(stock, daily[len(daily)-1], crossRows, master)
		}
	}
	data["errors"] = apiErrors
	return data, nil
}

func (c *tushareClient) stockList(ctx context.Context) ([]map[string]any, error) {
	stockCache.Lock()
	defer stockCache.Unlock()
	if len(stockCache.rows) > 0 && time.Now().Before(stockCache.expires) {
		return stockCache.rows, nil
	}
	rows, err := c.query(ctx, "stock_basic", map[string]string{"list_status": "L"}, stockBasicFields)
	if err != nil {
		return nil, err
	}
	stockCache.rows = rows
	stockCache.expires = time.Now().Add(6 * time.Hour)
	return rows, nil
}

func (c *tushareClient) query(ctx context.Context, apiName string, params map[string]string, fields string) ([]map[string]any, error) {
	body, err := json.Marshal(map[string]any{
		"api_name": apiName,
		"token":    c.token,
		"params":   params,
		"fields":   fields,
	})
	if err != nil {
		return nil, fmt.Errorf("Prepare %s request: %w", apiName, err)
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		request, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, tushareEndpoint, bytes.NewReader(body))
		if reqErr != nil {
			return nil, fmt.Errorf("Prepare %s request: %w", apiName, reqErr)
		}
		request.Header.Set("Content-Type", "application/json")
		response, requestErr := c.http.Do(request)
		if requestErr != nil {
			lastErr = requestErr
			if attempt == 0 && ctx.Err() == nil {
				time.Sleep(500 * time.Millisecond)
				continue
			}
			break
		}
		responseBytes, readErr := io.ReadAll(io.LimitReader(response.Body, maxTushareBody))
		response.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("Read %s response: %w", apiName, readErr)
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			return nil, fmt.Errorf("%s returned HTTP %d", apiName, response.StatusCode)
		}
		var envelope tushareEnvelope
		if err := json.Unmarshal(responseBytes, &envelope); err != nil {
			return nil, fmt.Errorf("Parse %s response: %w", apiName, err)
		}
		if envelope.Code != 0 {
			message := strings.TrimSpace(string(envelope.Msg))
			message = strings.Trim(message, `"`)
			if message == "" || message == "null" {
				message = "request failed"
			}
			return nil, fmt.Errorf("Tushare %s error %d: %s", apiName, envelope.Code, message)
		}
		if envelope.Data == nil || len(envelope.Data.Fields) == 0 {
			return []map[string]any{}, nil
		}
		rows := make([]map[string]any, 0, len(envelope.Data.Items))
		for _, item := range envelope.Data.Items {
			row := make(map[string]any, len(envelope.Data.Fields))
			for index, field := range envelope.Data.Fields {
				if index < len(item) {
					row[field] = item[index]
				} else {
					row[field] = nil
				}
			}
			rows = append(rows, row)
		}
		return rows, nil
	}
	return nil, fmt.Errorf("Tushare %s request failed: %w", apiName, lastErr)
}

func resolveStock(query string, stocks []map[string]any) (map[string]any, error) {
	needle := strings.TrimSpace(query)
	upper := strings.ToUpper(needle)
	if codeRE.MatchString(upper) {
		code := normalizeCode(upper)
		for _, stock := range stocks {
			if strings.EqualFold(stringValue(stock["ts_code"]), code) || strings.EqualFold(stringValue(stock["symbol"]), strings.Split(code, ".")[0]) {
				return stock, nil
			}
		}
		return nil, fmt.Errorf("No listed stock matched %q. Try a Tushare code such as 600519.SH.", needle)
	}

	var exact []map[string]any
	var partial []map[string]any
	for _, stock := range stocks {
		name := stringValue(stock["name"])
		if strings.EqualFold(name, needle) {
			exact = append(exact, stock)
		} else if strings.Contains(strings.ToLower(name), strings.ToLower(needle)) {
			partial = append(partial, stock)
		}
	}
	if len(exact) == 1 {
		return exact[0], nil
	}
	if len(exact) > 1 {
		return nil, fmt.Errorf("More than one stock is named %q. Enter its six-digit code.", needle)
	}
	if len(partial) == 1 {
		return partial[0], nil
	}
	if len(partial) > 1 {
		return nil, fmt.Errorf("More than one stock matches %q. Enter its six-digit code.", needle)
	}
	return nil, fmt.Errorf("No currently listed stock matched %q.", needle)
}

func normalizeCode(value string) string {
	value = strings.ToUpper(strings.TrimSpace(value))
	if strings.Contains(value, ".") {
		return value
	}
	if len(value) != 6 {
		return value
	}
	switch {
	case strings.HasPrefix(value, "92"), strings.HasPrefix(value, "8"), strings.HasPrefix(value, "4"):
		return value + ".BJ"
	case strings.HasPrefix(value, "6"), strings.HasPrefix(value, "9"):
		return value + ".SH"
	default:
		return value + ".SZ"
	}
}

func makeCrossSection(stock, current map[string]any, rows, masters []map[string]any) map[string]any {
	industry := stringValue(stock["industry"])
	industryByCode := make(map[string]string, len(masters))
	for _, master := range masters {
		industryByCode[stringValue(master["ts_code"])] = stringValue(master["industry"])
	}
	allReturns := make([]float64, 0, len(rows))
	peerReturns := make([]float64, 0, 256)
	upCount, downCount := 0, 0
	for _, row := range rows {
		value, ok := floatValue(row["pct_chg"])
		if !ok {
			continue
		}
		allReturns = append(allReturns, value)
		if value > 0 {
			upCount++
		} else if value < 0 {
			downCount++
		}
		if industry != "" && industryByCode[stringValue(row["ts_code"])] == industry {
			peerReturns = append(peerReturns, value)
		}
	}

	result := map[string]any{
		"industry":   industry,
		"up_count":   upCount,
		"down_count": downCount,
	}
	target, targetOK := floatValue(current["pct_chg"])
	marketMedian, marketOK := median(allReturns)
	if marketOK {
		result["market_median_pct"] = marketMedian
		if targetOK {
			result["market_adjusted_pct"] = target - marketMedian
			result["target_pct"] = target
		}
	}
	peerMedian, peerOK := median(peerReturns)
	if peerOK {
		result["peer_median_pct"] = peerMedian
		if targetOK {
			result["industry_adjusted_pct"] = target - peerMedian
			lessOrEqual := 0
			for _, value := range peerReturns {
				if value <= target {
					lessOrEqual++
				}
			}
			result["peer_percentile"] = float64(lessOrEqual) / float64(len(peerReturns)) * 100
		}
	}
	return result
}

func median(values []float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	middle := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[middle], true
	}
	return (sorted[middle-1] + sorted[middle]) / 2, true
}

func floatValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, !math.IsNaN(typed) && !math.IsInf(typed, 0)
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
	default:
		return 0, false
	}
}

func stringValue(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("Write JSON response: %v", err)
	}
}
