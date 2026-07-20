const supabase = require("../config/db");
const { notify } = require("../config/notify");

// ===========================
// GET semua produk
// ===========================
exports.getProducts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("id", { ascending: true });

    if (error) {
      return res.status(500).json({
        message: error.message,
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
} = req.body;

console.log(req.body);

    if (!name || !price) {
      return res.status(400).json({
        message: "Nama dan harga wajib diisi",
      });
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