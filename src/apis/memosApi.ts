/**
 * Memos API
 */
export class MemosApi {
    private baseUrl: string;
    private accessToken: string;
    private headers;
  
    constructor(baseUrl, accessToken) {
      this.baseUrl = baseUrl;
      this.accessToken = accessToken;
      this.headers = {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'User-Agent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36 Edg/116.0.1938.76"
      }
    }
  
    /**
     * 发送GET请求
     * @param interfacePath - 接口路径
     * @param params - 参数
     * @returns 
     */
    async fetchGet(interfacePath, params = {}) {
      let url = new URL(`${this.baseUrl}${interfacePath}`);
  
      if (Object.keys(params).length > 0) {
        url.search = new URLSearchParams(params).toString();
      }

      return await fetch(url, {
        method: 'GET',
        headers: this.headers
      });
    }
  
    /**
     * 发送POST请求
     * @param interfacePath - 接口路径
     * @param data - 参数
     * @returns 
     */
    async fetchPost(interfacePath, data = {}) {
      let url = `${this.baseUrl}${interfacePath}`;
  
      return await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: Object.keys(data).length > 0 ? JSON.stringify(data) : null
      });
    }

    /**
     * 检查系统是否能够访问
     * @returns 
     */
    async pingMemos(){
      return await this.fetchGet('/api/v1/ping');
    }

    /**
     * 获取当前用户
     * @returns 
     */
    async getUserMe(){
      return await this.fetchGet('/api/v1/user/me');
    }
  
    /**
     * 获取Memos列表
     * @param param - 请求参数
     * @returns 
     */
    async getMemos(param){
      return await this.fetchGet('/api/v1/memo', param);
    }
  
    /**
     * 获取标签列表
     * @returns 
     */
    async getTags() {
      return await this.fetchGet('/api/v1/tag');
    }

    /**
     * 根据ID下载资源
     * @param id - 资源ID
     * @returns 
     */
    async downloadResourceById(id){
      return await this.fetchGet(`/o/r/${id}`);
    }

    /**
     * 根据名称下载资源
     * @param name 
     * @returns 
     */
    async downloadResourceByName(name){
      return await this.fetchGet(`/o/r/${name}`);
    }
  }