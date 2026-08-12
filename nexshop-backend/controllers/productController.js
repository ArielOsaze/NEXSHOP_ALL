const supabase = require("../config/db");
const { notify } = require("../config/notify");

// ===========================
// GET semua produk
// ===========================
exports.getProducts = async (req, res) => {
  try {
    let isAdmin = false;
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (match) {
        try {
          const decoded = require("jsonwebtoken").verify(match[1], process.env.JWT_SECRET);
          if (decoded.role === "admin") {
            isAdmin = true;
          }
        } catch (e) {}
      }
    }

    let query = supabase
      .from("products")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (!isAdmin) {
      query = query.or("is_active.eq.true,is_active.is.null");
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        message: process.env.NODE_ENV === "production" ? "Gagal memuat produk" : error.message,
      });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({
      message: process.env.NODE_ENV === "production" ? "Terjadi kesalahan pada server" : err.message,
    });
  }
};

// ===========================
// GET produk berdasarkan ID
// ===========================
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return res.status(404).json({
        message: "Produk tidak ditemukan",
      });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// ===========================
// TAMBAH PRODUK
// ===========================
exports.createProduct = async (req, res) => {
  if (!["admin", "staff"].includes(req.user.role)) {
    return res.status(403).json({ message: "Akses ditolak, khusus admin" });
  }
  try {
  const {
    name,
    price,
    image,
    badge,
    rating,
    sold,
    description,
    category,
    strike_price,
    is_flash_sale,
    sort_order,
    is_active,
  } = req.body;

  if (!name || !price) {
      return res.status(400).json({
        message: "Nama dan harga wajib diisi",
      });
    }

    let finalSortOrder = sort_order;
    if (finalSortOrder === undefined || finalSortOrder === null || finalSortOrder === "") {
      const { data: maxRow } = await supabase
        .from("products")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      finalSortOrder = (maxRow && maxRow.sort_order != null ? maxRow.sort_order : 0) + 1;
    }

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          name,
          price,
          image,
          badge,
          rating,
          sold,
          description,
          category,
          strike_price: strike_price || null,
          is_flash_sale: !!is_flash_sale,
          sort_order: finalSortOrder,
          is_active: is_active !== undefined ? !!is_active : true,
        },
      ])
      .select();

    if (error) {
      return res.status(500).json({
        message: error.message,
      });
    }

    res.status(201).json({
      message: "Produk berhasil ditambahkan",
      data,
    });

    notify("product", `📦 ${req.user.email} menambahkan produk baru "${name}"`);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// ===========================
// UPDATE PRODUK
// ===========================
exports.updateProduct = async (req, res) => {
  if (!["admin", "staff"].includes(req.user.role)) {
    return res.status(403).json({ message: "Akses ditolak, khusus admin" });
  }
  try {
    const { id } = req.params;

    const {
      name,
      price,
      image,
      badge,
      rating,
      sold,
      description,
      category,
      strike_price,
      is_flash_sale,
      sort_order,
      is_active,
    } = req.body;

    const { data, error } = await supabase
      .from("products")
      .update({
        name,
        price,
        image,
        badge,
        rating,
        sold,
        description,
        category,
        strike_price: strike_price || null,
        is_flash_sale: !!is_flash_sale,
        ...(is_active !== undefined ? { is_active: !!is_active } : {}),
        ...(sort_order === undefined || sort_order === null || sort_order === "" ? {} : { sort_order }),
      })
      .eq("id", id)
      .select();

    if (error) {
      return res.status(500).json({
        message: error.message,
      });
    }

    if (!data.length) {
      return res.status(404).json({
        message: "Produk tidak ditemukan",
      });
    }

    notify("product", `✏️ ${req.user.email} mengubah produk "${name}"`);

    res.json({
      message: "Produk berhasil diupdate",
      data,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// ===========================
// HAPUS PRODUK
// ===========================
exports.deleteProduct = async (req, res) => {
  if (!["admin", "staff"].includes(req.user.role)) {
    return res.status(403).json({ message: "Akses ditolak, khusus admin" });
  }
  try {
    const { id } = req.params;

    const { data: existing } = await supabase
      .from("products")
      .select("name")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({
        message: error.message,
      });
    }

    notify("product", `🗑️ ${req.user.email} menghapus produk "${existing?.name || id}"`);

    res.json({
      message: "Produk berhasil dihapus",
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};
