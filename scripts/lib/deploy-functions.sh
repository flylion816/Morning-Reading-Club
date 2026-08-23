#!/bin/bash

################################################################################
# 部署函数库 - 包含所有部署相关的可复用函数
# 用途：build、install、restart 等核心部署操作
# 注意：必须先 source scripts/lib/utils.sh，此库才能使用 log_* 函数
################################################################################

# 源加载 utils 库（如果未加载）
if [ -z "$(type -t log_success)" ]; then
  source "$(dirname "${BASH_SOURCE[0]}")/utils.sh" || {
    echo "❌ 无法加载 utils.sh，脚本中止"
    exit 1
  }
fi

################################################################################
# 前端构建相关
################################################################################

# 构建 Vue3 管理后台
# 用法：build_admin /path/to/admin
# 返回：0 成功，1 失败
build_admin() {
  local admin_dir="$1"

  if [ -z "$admin_dir" ] || [ ! -d "$admin_dir" ]; then
    log_error "管理后台目录无效: $admin_dir"
    return 1
  fi

  log_section "构建管理后台"
  cd "$admin_dir"

  log_info "当前目录: $(pwd)"
  log_info "安装依赖..."
  npm install --silent || {
    log_error "npm install 失败"
    return 1
  }

  log_info "执行构建..."
  npm run build || {
    log_error "npm run build 失败"
    return 1
  }

  if [ ! -d "dist" ]; then
    log_error "构建失败: dist 目录不存在"
    return 1
  fi

  log_success "管理后台构建完成"
  return 0
}

################################################################################
# 后端依赖相关
################################################################################

# 安装后端依赖
# 用法：install_backend_dependencies /var/www/morning-reading/backend
# 返回：0 成功，1 失败
install_backend_dependencies() {
  local backend_dir="$1"

  if [ -z "$backend_dir" ] || [ ! -d "$backend_dir" ]; then
    log_error "后端目录无效: $backend_dir"
    return 1
  fi

  log_section "安装后端依赖"

  log_info "目录: $backend_dir"
  cd "$backend_dir" || return 1

  log_info "执行 npm install..."
  npm install --silent || {
    log_error "npm install 失败"
    return 1
  }

  log_success "后端依赖安装完成"
  return 0
}

################################################################################
# PM2 进程管理相关
################################################################################

# 获取 PM2 命令，优先使用全局安装版本
get_pm2_cmd() {
  if command -v pm2 &>/dev/null; then
    echo "pm2"
  else
    echo "npx -y pm2"
  fi
}

# 确保全局 PM2 可用，以便配置 systemd 自启动
ensure_global_pm2() {
  if command -v pm2 &>/dev/null; then
    log_success "全局 PM2 已可用: $(command -v pm2)"
    return 0
  fi

  log_warning "未检测到全局 PM2，准备安装以支持开机自启"
  if [ "$(type -t install_pm2)" = "function" ]; then
    install_pm2 || return 1
  else
    local npm_registry="${NPM_REGISTRY:-https://registry.npmjs.org}"
    sudo npm install -g pm2 --silent --registry "$npm_registry" >/dev/null 2>&1 || {
      log_error "全局 PM2 安装失败"
      return 1
    }
  fi

  if command -v pm2 &>/dev/null; then
    log_success "全局 PM2 安装完成: $(command -v pm2)"
    return 0
  fi

  log_error "全局 PM2 仍不可用"
  return 1
}

# 保存 PM2 进程列表并配置 systemd 开机自启动
ensure_pm2_autostart() {
  local backend_dir="$1"
  local service_user="${SUDO_USER:-$(id -un)}"
  local service_home="$HOME"

  log_section "配置 PM2 开机自启"

  if ! ensure_global_pm2; then
    log_error "无法配置 PM2 开机自启"
    return 1
  fi

  if command -v getent &>/dev/null; then
    local detected_home
    detected_home="$(getent passwd "$service_user" | cut -d: -f6)"
    if [ -n "$detected_home" ]; then
      service_home="$detected_home"
    fi
  fi

  local pm2_cmd="pm2"
  local service_name="pm2-$service_user"
  local systemd_path="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

  if [ -n "$backend_dir" ] && [ -d "$backend_dir" ]; then
    cd "$backend_dir" || return 1
  fi

  log_info "保存当前 PM2 进程列表..."
  $pm2_cmd save >/dev/null || {
    log_error "PM2 save 失败"
    return 1
  }

  if ! command -v systemctl &>/dev/null; then
    log_warning "未检测到 systemctl，跳过 PM2 开机自启配置"
    return 0
  fi

  log_info "配置 systemd 服务: $service_name"
  sudo env PATH="$systemd_path" "$pm2_cmd" startup systemd -u "$service_user" --hp "$service_home" >/dev/null 2>&1 || {
    log_error "PM2 startup 配置失败"
    return 1
  }

  sudo systemctl daemon-reload >/dev/null 2>&1 || {
    log_error "systemd daemon-reload 失败"
    return 1
  }

  sudo systemctl enable "$service_name" >/dev/null 2>&1 || {
    log_error "启用 $service_name 失败"
    return 1
  }

  log_success "PM2 开机自启已启用: $service_name"
  return 0
}

# 重启 PM2 应用
# 用法：restart_pm2_app morning-reading-backend /var/www/morning-reading/backend
# 返回：0 成功，1 失败
restart_pm2_app() {
  local app_name="$1"
  local backend_dir="$2"

  if [ -z "$app_name" ]; then
    log_error "应用名称为空"
    return 1
  fi

  log_section "重启 PM2 应用"

  # 确定 PM2 命令
  local pm2_cmd
  pm2_cmd="$(get_pm2_cmd)"

  log_info "PM2 命令: $pm2_cmd"
  log_info "应用名称: $app_name"

  # 检查应用是否已存在
  if $pm2_cmd describe "$app_name" &>/dev/null; then
    log_info "应用已存在，执行重载..."
    $pm2_cmd reload "$app_name" --update-env || {
      log_error "PM2 reload 失败"
      return 1
    }
  else
    log_info "应用不存在，使用 pm2.config.js 启动..."
    if [ -z "$backend_dir" ] || [ ! -f "$backend_dir/pm2.config.js" ]; then
      log_error "pm2.config.js 不存在: $backend_dir/pm2.config.js"
      return 1
    fi

    cd "$backend_dir" || return 1
    $pm2_cmd start pm2.config.js --env production || {
      log_error "PM2 start 失败"
      return 1
    }
  fi

  sleep 2
  log_success "PM2 应用重启完成"
  return 0
}

# 停止 PM2 应用
# 用法：stop_pm2_app morning-reading-backend
# 返回：0 成功，1 失败
stop_pm2_app() {
  local app_name="$1"

  if [ -z "$app_name" ]; then
    log_error "应用名称为空"
    return 1
  fi

  log_section "停止 PM2 应用"

  local pm2_cmd
  pm2_cmd="$(get_pm2_cmd)"

  log_info "停止应用: $app_name"
  $pm2_cmd stop "$app_name" 2>/dev/null || {
    log_warning "应用可能未运行"
  }

  log_success "PM2 应用已停止"
  return 0
}

# 配置 PM2 日志轮转
# 用法：setup_pm2_logrotate
# 返回：0 成功，1 失败
setup_pm2_logrotate() {
  log_section "配置 PM2 日志轮转"

  local pm2_cmd
  pm2_cmd="$(get_pm2_cmd)"

  log_info "安装 pm2-logrotate 模块..."
  $pm2_cmd install pm2-logrotate 2>/dev/null || {
    log_warning "pm2-logrotate 安装失败，继续..."
  }

  sleep 1

  log_info "配置日志参数..."
  # 单个文件 500MB，保留 10 个文件（总共 5GB）
  $pm2_cmd set pm2-logrotate:max_size 500M || true
  $pm2_cmd set pm2-logrotate:retain 10 || true

  log_success "日志轮转已配置：500MB/文件 × 10个 = 5GB总量"
  return 0
}

# 查看 PM2 应用状态
# 用法：check_pm2_status morning-reading-backend
check_pm2_status() {
  local app_name="$1"

  if [ -z "$app_name" ]; then
    log_error "应用名称为空"
    return 1
  fi

  local pm2_cmd
  pm2_cmd="$(get_pm2_cmd)"

  $pm2_cmd describe "$app_name" 2>/dev/null || {
    log_warning "应用 $app_name 未在 PM2 中"
    return 1
  }
}

################################################################################
# Nginx 相关
################################################################################

# 验证 Nginx 配置
# 用法：validate_nginx_config
# 返回：0 成功，1 失败
validate_nginx_config() {
  log_section "验证 Nginx 配置"

  if ! sudo nginx -t 2>&1 | grep -q "successful"; then
    log_error "Nginx 配置验证失败"
    sudo nginx -t
    return 1
  fi

  log_success "Nginx 配置验证成功"
  return 0
}

# 重新加载 Nginx（不中断连接）
# 用法：reload_nginx
# 返回：0 成功，1 失败
reload_nginx() {
  log_section "重新加载 Nginx"

  if ! validate_nginx_config; then
    return 1
  fi

  log_info "执行 nginx reload..."
  if sudo nginx -s reload 2>/dev/null; then
    log_success "Nginx 已重新加载"
    return 0
  else
    log_error "Nginx reload 失败"
    return 1
  fi
}

# 重启 Nginx（会中断连接）
# 用法：restart_nginx
# 返回：0 成功，1 失败
restart_nginx() {
  log_section "重启 Nginx"

  if ! validate_nginx_config; then
    return 1
  fi

  log_info "执行 systemctl restart nginx..."
  if sudo systemctl restart nginx 2>/dev/null; then
    log_success "Nginx 已重启"
    return 0
  else
    log_error "Nginx restart 失败"
    return 1
  fi
}

################################################################################
# 备份相关
################################################################################

# 在服务器上创建备份（排除大文件）
# 用法：create_server_backup /var/www/morning-reading ubuntu 118.25.145.179 ~/.ssh/id_rsa
# 返回：0 成功，1 失败
create_server_backup() {
  local backup_path="$1"
  local server_user="$2"
  local server_ip="$3"
  local ssh_key="$4"
  local timestamp=$(date +%Y%m%d_%H%M%S)

  if [ -z "$backup_path" ] || [ -z "$server_user" ] || [ -z "$server_ip" ]; then
    log_error "参数不完整: backup_path server_user server_ip"
    return 1
  fi

  log_section "在服务器上创建备份"

  log_info "服务器: $server_user@$server_ip:$backup_path"

  # 检查目录是否存在
  if ssh -i "$ssh_key" -o StrictHostKeyChecking=no "$server_user@$server_ip" \
    "[ -d $backup_path ]" 2>/dev/null; then

    log_info "发现现有部署，创建备份（排除 logs、node_modules、.git）..."

    local backup_cmd="cd $(dirname "$backup_path") && sudo tar --exclude='$(basename "$backup_path")/backend/logs' --exclude='$(basename "$backup_path")/node_modules' --exclude='$(basename "$backup_path")/.git' -czf $(basename "$backup_path")_bak_${timestamp}.tar.gz $(basename "$backup_path")/"

    if ssh -i "$ssh_key" -o StrictHostKeyChecking=no "$server_user@$server_ip" "$backup_cmd" 2>/dev/null; then
      log_success "服务器备份完成: $(basename "$backup_path")_bak_${timestamp}.tar.gz"

      # 只保留最近2个备份，删除更早的
      local cleanup_cmd="cd $(dirname "$backup_path") && ls -t $(basename "$backup_path")_bak_*.tar.gz 2>/dev/null | tail -n +3 | xargs sudo rm -f"
      ssh -i "$ssh_key" -o StrictHostKeyChecking=no "$server_user@$server_ip" "$cleanup_cmd" 2>/dev/null && \
        log_info "旧备份已清理，保留最近2个" || true

      echo "$timestamp"  # 返回时间戳供后续使用
      return 0
    else
      log_error "服务器备份失败"
      return 1
    fi
  else
    log_success "首次部署，无需备份（目录不存在）"
    echo "first-deploy"
    return 0
  fi
}

################################################################################
# 文件复制相关
################################################################################

# 复制配置文件到服务器
# 用法：copy_config_files_to_server /path/to/.env.config.js ubuntu 118.25.145.179 ~/.ssh/id_rsa /var/www/morning-reading
# 返回：0 成功，1 失败
copy_config_files_to_server() {
  local local_config="$1"
  local server_user="$2"
  local server_ip="$3"
  local ssh_key="$4"
  local server_path="$5"

  log_section "复制配置文件到服务器"

  if [ ! -f "$local_config" ]; then
    log_warning "配置文件不存在，跳过: $local_config"
    return 0
  fi

  log_info "上传: $local_config → $server_path/"

  if scp -i "$ssh_key" -o StrictHostKeyChecking=no "$local_config" \
    "$server_user@$server_ip:$server_path/" 2>/dev/null; then
    log_success "配置文件已复制"
    return 0
  else
    log_error "配置文件复制失败"
    return 1
  fi
}

################################################################################
# 部署包相关
################################################################################

# 在服务器上解压并部署文件
# 用法：deploy_files_on_server /tmp/package.tar.gz /var/www/morning-reading ubuntu 118.25.145.179 ~/.ssh/id_rsa
# 返回：0 成功，1 失败
deploy_files_on_server() {
  local package_path="$1"
  local server_path="$2"
  local server_user="$3"
  local server_ip="$4"
  local ssh_key="$5"
  local timestamp=$(date +%Y%m%d_%H%M%S)

  log_section "在服务器上部署文件"

  local remote_package="/tmp/$(basename "$package_path")"
  local extract_dir="/tmp/morning-reading-extract-${timestamp}"

  log_info "远程包位置: $remote_package"
  log_info "解压目录: $extract_dir"

  # 构建部署脚本
  local deploy_script=$(cat <<'DEPLOY_SCRIPT_EOF'
#!/bin/bash
set -e

PACKAGE_PATH="$1"
EXTRACT_DIR="$2"
SERVER_PATH="$3"

# 颜色定义
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }

log_info "解压文件..."
mkdir -p "$EXTRACT_DIR"
tar -xzf "$PACKAGE_PATH" -C "$EXTRACT_DIR" --strip-components=1

# 确保目录存在且有正确权限
sudo mkdir -p "$SERVER_PATH/backend" "$SERVER_PATH/admin/dist"
sudo mkdir -p /var/www/logs
sudo chown -R ubuntu:ubuntu "$SERVER_PATH" 2>/dev/null || true
sudo chown ubuntu:ubuntu /var/www/logs 2>/dev/null || true
sudo chmod 755 /var/www/logs 2>/dev/null || true

log_info "部署后端..."
if [ -d "$EXTRACT_DIR/backend" ]; then
  sudo cp -r "$EXTRACT_DIR/backend/src" "$SERVER_PATH/backend/"
  sudo cp -r "$EXTRACT_DIR/backend/scripts" "$SERVER_PATH/backend/" 2>/dev/null || true
  sudo cp -r "$EXTRACT_DIR/backend/package.json" "$SERVER_PATH/backend/"
  sudo cp -r "$EXTRACT_DIR/backend/package-lock.json" "$SERVER_PATH/backend/" 2>/dev/null || true
  sudo cp -r "$EXTRACT_DIR/backend/pm2.config.js" "$SERVER_PATH/backend/" 2>/dev/null || true
  log_success "后端文件和巡检脚本已覆盖"
fi

log_info "部署管理后台..."
if [ -d "$EXTRACT_DIR/admin/dist" ]; then
  sudo rm -rf "$SERVER_PATH/admin/dist"
  sudo cp -r "$EXTRACT_DIR/admin/dist" "$SERVER_PATH/admin/"
  log_success "管理后台已覆盖"
fi

log_info "复制服务器脚本..."
if [ -d "$EXTRACT_DIR/scripts" ]; then
  cp "$EXTRACT_DIR/scripts/"*.sh "$SERVER_PATH/" 2>/dev/null || true
  chmod +x "$SERVER_PATH/"*.sh
  log_success "服务器脚本已复制"
fi

log_info "清理临时文件..."
rm -rf "$EXTRACT_DIR"
rm -f "$PACKAGE_PATH"

log_success "文件部署完成"
DEPLOY_SCRIPT_EOF
)

  if ssh -i "$ssh_key" -o StrictHostKeyChecking=no "$server_user@$server_ip" \
    bash -s "$remote_package" "$extract_dir" "$server_path" <<< "$deploy_script" 2>/dev/null; then
    log_success "服务器部署完成"
    return 0
  else
    log_error "服务器部署失败"
    return 1
  fi
}

################################################################################
# 验证部署相关
################################################################################

# 验证后端是否在线
# 用法：verify_backend_online ubuntu 118.25.145.179 ~/.ssh/id_rsa morning-reading-backend
verify_backend_online() {
  local server_user="$1"
  local server_ip="$2"
  local ssh_key="$3"
  local pm2_app="$4"

  log_section "验证后端服务"

  if ssh -i "$ssh_key" -o StrictHostKeyChecking=no "$server_user@$server_ip" \
    "pm2 describe $pm2_app 2>/dev/null | grep -q 'online'" 2>/dev/null; then
    log_success "后端服务正常 (online)"
    return 0
  else
    log_warning "后端服务状态异常，请手动检查"
    return 1
  fi
}

# 验证管理后台文件
# 用法：verify_admin_files ubuntu 118.25.145.179 ~/.ssh/id_rsa /var/www/morning-reading/admin/dist
verify_admin_files() {
  local server_user="$1"
  local server_ip="$2"
  local ssh_key="$3"
  local admin_dist="$4"

  log_section "验证管理后台文件"

  if ssh -i "$ssh_key" -o StrictHostKeyChecking=no "$server_user@$server_ip" \
    "[ -f $admin_dist/index.html ]" 2>/dev/null; then
    log_success "管理后台文件就绪"
    return 0
  else
    log_warning "管理后台文件异常，请手动检查"
    return 1
  fi
}

################################################################################
# 导出函数，使其在 sourced 脚本中可用
################################################################################

export -f build_admin
export -f install_backend_dependencies
export -f get_pm2_cmd
export -f ensure_global_pm2
export -f ensure_pm2_autostart
export -f restart_pm2_app
export -f stop_pm2_app
export -f setup_pm2_logrotate
export -f check_pm2_status
export -f validate_nginx_config
export -f reload_nginx
export -f restart_nginx
export -f create_server_backup
export -f copy_config_files_to_server
export -f deploy_files_on_server
export -f verify_backend_online
export -f verify_admin_files
